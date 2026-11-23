//! Finding other Glyph devices on the local network, and a small message
//! channel to them.
//!
//! This is only a transport; the pairing conversation (who is asking, the
//! confirm number, the remembered-device proof) is written in TypeScript
//! (`src/lib/sync/nearby.ts`). Rust does what a webview cannot:
//!
//! * announce this device with mDNS (`_glyph-sync._tcp`) and list the others,
//! * listen on a TCP port and connect to another device's port,
//! * carry newline-delimited text messages in both directions.
//!
//! Nothing here leaves the local network, and nothing is sent until the Sync
//! page asks for it (`discovery_start`) and the user picks a device.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const SERVICE_TYPE: &str = "_glyph-sync._tcp.local.";
/// The longest message accepted (an offer or reply code is a few kilobytes).
const MAX_LINE: u64 = 256 * 1024;
/// A connection that says nothing for this long is dropped.
const IDLE_TIMEOUT: Duration = Duration::from_secs(180);
/// How long to try one address of the other device.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);

/// Another device found on the network.
#[derive(Clone, Serialize)]
struct Peer {
  id: String,
  name: String,
  hosts: Vec<String>,
  port: u16,
}

#[derive(Clone, Serialize)]
struct MessageEvent {
  conn: u64,
  message: String,
}

#[derive(Clone, Serialize)]
struct ClosedEvent {
  conn: u64,
}

struct Running {
  daemon: ServiceDaemon,
  stop: Arc<AtomicBool>,
  fullname: String,
}

type Conns = Arc<Mutex<HashMap<u64, TcpStream>>>;
type Peers = Arc<Mutex<HashMap<String, Peer>>>;

/// The state shared with the commands; managed by the Tauri app.
#[derive(Default)]
pub struct Discovery {
  running: Mutex<Option<Running>>,
  peers: Peers,
  conns: Conns,
  next_conn: Arc<AtomicU64>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
  m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Reads messages from one connection and reports them until it ends.
fn spawn_reader(app: AppHandle, conns: Conns, conn: u64, stream: TcpStream) {
  thread::spawn(move || {
    let _ = stream.set_read_timeout(Some(IDLE_TIMEOUT));
    let mut reader = BufReader::new(stream);
    loop {
      let mut line = String::new();
      match reader.by_ref().take(MAX_LINE).read_line(&mut line) {
        Ok(0) | Err(_) => break,
        Ok(_) => {
          // No newline means the message was cut off at the size limit.
          if !line.ends_with('\n') {
            break;
          }
          let message = line.trim_end_matches(['\r', '\n']).to_string();
          let _ = app.emit("nearby://message", MessageEvent { conn, message });
        }
      }
    }
    if let Some(stream) = lock(&conns).remove(&conn) {
      let _ = stream.shutdown(std::net::Shutdown::Both);
    }
    let _ = app.emit("nearby://closed", ClosedEvent { conn });
  });
}

/// Keeps a connection for sending and starts reading from it.
fn adopt(app: &AppHandle, conns: &Conns, next: &AtomicU64, stream: TcpStream) -> Result<u64, String> {
  let _ = stream.set_nodelay(true);
  let writer = stream.try_clone().map_err(|e| e.to_string())?;
  let conn = next.fetch_add(1, Ordering::SeqCst) + 1;
  lock(conns).insert(conn, writer);
  spawn_reader(app.clone(), conns.clone(), conn, stream);
  Ok(conn)
}

fn publish(app: &AppHandle, peers: &Peers) {
  let mut list: Vec<Peer> = lock(peers).values().cloned().collect();
  list.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
  let _ = app.emit("nearby://peers", list);
}

fn instance_of(fullname: &str) -> String {
  fullname
    .split("._glyph-sync")
    .next()
    .unwrap_or(fullname)
    .to_string()
}

fn stop_running(state: &Discovery) {
  if let Some(running) = lock(&state.running).take() {
    running.stop.store(true, Ordering::SeqCst);
    let _ = running.daemon.unregister(&running.fullname);
    let _ = running.daemon.shutdown();
  }
  lock(&state.peers).clear();
  for (_, stream) in lock(&state.conns).drain() {
    let _ = stream.shutdown(std::net::Shutdown::Both);
  }
}

/// Starts announcing this device and listing the others. Calling it again
/// restarts it (a new id or name).
#[tauri::command]
pub fn discovery_start(
  app: AppHandle,
  state: State<'_, Discovery>,
  id: String,
  name: String,
) -> Result<(), String> {
  stop_running(&state);

  let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|e| e.to_string())?;
  let port = listener.local_addr().map_err(|e| e.to_string())?.port();
  listener.set_nonblocking(true).map_err(|e| e.to_string())?;

  let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;
  let host = format!("{id}.local.");
  let info = ServiceInfo::new(
    SERVICE_TYPE,
    &id,
    &host,
    "",
    port,
    &[("name", name.as_str()), ("v", "1")][..],
  )
  .map_err(|e| e.to_string())?
  .enable_addr_auto();
  let fullname = info.get_fullname().to_string();
  daemon.register(info).map_err(|e| e.to_string())?;
  let browse = daemon.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;

  let stop = Arc::new(AtomicBool::new(false));

  // Incoming connections.
  {
    let app = app.clone();
    let conns = state.conns.clone();
    let next = state.next_conn.clone();
    let stop = stop.clone();
    thread::spawn(move || {
      while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
          Ok((stream, _)) => {
            let _ = stream.set_nonblocking(false);
            let _ = adopt(&app, &conns, &next, stream);
          }
          Err(_) => thread::sleep(Duration::from_millis(100)),
        }
      }
    });
  }

  // Other devices appearing and going away.
  {
    let app = app.clone();
    let peers = state.peers.clone();
    let stop = stop.clone();
    let own_id = id.clone();
    thread::spawn(move || {
      while !stop.load(Ordering::SeqCst) {
        match browse.recv_timeout(Duration::from_millis(500)) {
          Ok(ServiceEvent::ServiceResolved(info)) => {
            let peer_id = instance_of(info.get_fullname());
            if peer_id == own_id {
              continue;
            }
            let mut hosts: Vec<Ipv4Addr> = info
              .get_addresses_v4()
              .into_iter()
              .filter(|a| !a.is_loopback() && !a.is_link_local() && !a.is_unspecified())
              .collect();
            hosts.sort();
            if hosts.is_empty() {
              continue;
            }
            let name = info
              .get_property_val_str("name")
              .unwrap_or("Another device")
              .to_string();
            lock(&peers).insert(
              peer_id.clone(),
              Peer {
                id: peer_id,
                name,
                hosts: hosts.iter().map(|a| a.to_string()).collect(),
                port: info.get_port(),
              },
            );
            publish(&app, &peers);
          }
          Ok(ServiceEvent::ServiceRemoved(_, fullname)) => {
            if lock(&peers).remove(&instance_of(&fullname)).is_some() {
              publish(&app, &peers);
            }
          }
          Ok(_) => {}
          Err(_) => {
            if browse.is_disconnected() {
              break;
            }
          }
        }
      }
    });
  }

  *lock(&state.running) = Some(Running { daemon, stop, fullname });
  publish(&app, &state.peers);
  Ok(())
}

/// Stops announcing, forgets the list and closes every connection.
#[tauri::command]
pub fn discovery_stop(state: State<'_, Discovery>) {
  stop_running(&state);
}

/// Opens a connection to a listed device; returns its connection number.
#[tauri::command]
pub async fn discovery_connect(
  app: AppHandle,
  state: State<'_, Discovery>,
  peer: String,
) -> Result<u64, String> {
  let found = lock(&state.peers).get(&peer).cloned();
  let found = found.ok_or_else(|| "That device is no longer visible.".to_string())?;
  let conns = state.conns.clone();
  let next = state.next_conn.clone();
  tauri::async_runtime::spawn_blocking(move || {
    let mut last = "no address worked".to_string();
    for host in &found.hosts {
      let Ok(ip) = host.parse::<IpAddr>() else { continue };
      match TcpStream::connect_timeout(&SocketAddr::new(ip, found.port), CONNECT_TIMEOUT) {
        Ok(stream) => return adopt(&app, &conns, &next, stream),
        Err(e) => last = e.to_string(),
      }
    }
    Err(format!("Could not reach that device ({last})."))
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Sends one message (a single line) on a connection.
#[tauri::command]
pub fn discovery_send(state: State<'_, Discovery>, conn: u64, message: String) -> Result<(), String> {
  if message.contains('\n') || message.len() as u64 >= MAX_LINE {
    return Err("Message not allowed.".into());
  }
  let mut conns = lock(&state.conns);
  let stream = conns.get_mut(&conn).ok_or_else(|| "The connection is closed.".to_string())?;
  stream
    .write_all(format!("{message}\n").as_bytes())
    .and_then(|_| stream.flush())
    .map_err(|e| e.to_string())
}

/// Closes one connection.
#[tauri::command]
pub fn discovery_close(state: State<'_, Discovery>, conn: u64) {
  if let Some(stream) = lock(&state.conns).remove(&conn) {
    let _ = stream.shutdown(std::net::Shutdown::Both);
  }
}
