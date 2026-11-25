//! Puente stdin/stdout JSONL para probar HttpEngine (Rust + reqwest + native-tls) desde Node/Vitest.

use std::io::{BufRead, Write};
use serde::{Deserialize, Serialize};
use ferrurl_lib::http::{HttpEngine, NetworkConfig, WireRequest};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase")]
enum Cmd {
    SetConfig { id: u64, config: NetworkConfig },
    Send { id: u64, req: WireRequest },
}

#[derive(Serialize)]
struct Reply {
    id: u64,
    ok: bool,
    result: serde_json::Value,
}

#[tokio::main]
async fn main() {
    let engine = std::sync::Arc::new(HttpEngine::default());
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Reply>();

    let writer = tokio::spawn(async move {
        while let Some(r) = rx.recv().await {
            let line = serde_json::to_string(&r).unwrap();
            let stdout = std::io::stdout();
            let mut out = stdout.lock();
            let _ = writeln!(out, "{line}");
            let _ = out.flush();
        }
    });

    let stdin = std::io::stdin();
    let mut handles = vec![];
    for line in stdin.lock().lines().map_while(Result::ok) {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let cmd: Cmd = serde_json::from_str(t).expect("JSON invalido");
        let eng = engine.clone();
        let tx = tx.clone();
        handles.push(tokio::spawn(async move {
            let reply = match cmd {
                Cmd::SetConfig { id, config } => match eng.set_config(config).await {
                    Ok(()) => Reply { id, ok: true, result: serde_json::Value::Null },
                    Err(e) => Reply { id, ok: false, result: serde_json::to_value(e).unwrap() },
                },
                Cmd::Send { id, req } => match eng.send(req).await {
                    Ok(resp) => Reply { id, ok: true, result: serde_json::to_value(resp).unwrap() },
                    Err(e) => Reply { id, ok: false, result: serde_json::to_value(e).unwrap() },
                },
            };
            let _ = tx.send(reply);
        }));
    }

    for h in handles {
        let _ = h.await;
    }
    drop(tx);
    let _ = writer.await;
}
