import { useState } from "react";

const steps = [
  {
    id: 1,
    title: "Step 1 — Initial Setup",
    subtitle: "Run once after installing Termux",
    blocks: [
      {
        label: "Install packages",
        code: `pkg update -y && pkg upgrade -y
pkg install -y python cronie curl git
pip install requests`
      },
      {
        label: "Create folders",
        code: `mkdir -p ~/privacy_buffer ~/logs`
      }
    ]
  },
  {
    id: 2,
    title: "Step 2 — Create Collector Script",
    subtitle: "Paste this entire block — creates collect.py",
    blocks: [
      {
        label: "Create collect.py",
        code: `cat > ~/collect.py << 'PYEOF'
#!/usr/bin/env python3

import subprocess, json, datetime, requests, os, sys

WORKER_URL = "https://privacy-ingest.YOUR_SUBDOMAIN.workers.dev"

def run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()

def get_timestamp():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def collect_permissions():
    apps = run("pm list packages -3").replace("package:", "").split("\\n")
    result = {}
    for app in apps:
        if not app.strip():
            continue
        raw = run(f"dumpsys package {app} | grep 'granted=true'")
        perms = [line.strip().split(":")[0] for line in raw.split("\\n") if line.strip()]
        result[app] = {"permissions": perms}
    return result

def collect_network():
    tcp = run("cat /proc/net/tcp6")
    entries = []
    for line in tcp.split("\\n")[1:]:
        parts = line.split()
        if len(parts) < 4:
            continue
        try:
            port = int(parts[2][-4:], 16)
        except:
            port = 0
        entries.append({
            "destination": parts[2],
            "port": port,
            "app": "unknown",
            "sent": 0,
            "received": 0
        })
    return entries[:100]

def collect_apps():
    all_apps = run("pm list packages").replace("package:", "").split("\\n")
    user_apps = run("pm list packages -3").replace("package:", "").split("\\n")
    return {
        "total": len(all_apps),
        "user_installed": len(user_apps),
        "user_apps": [a for a in user_apps if a.strip()]
    }

def send(payload_type, data):
    payload = {
        "type": payload_type,
        "timestamp": get_timestamp(),
        "data": data
    }
    try:
        r = requests.post(WORKER_URL, json=payload, timeout=15)
        print(f"[{payload_type}] {r.status_code}")
    except Exception as e:
        buffer_local(payload)
        print(f"[{payload_type}] buffered: {e}")

def buffer_local(payload):
    os.makedirs(os.path.expanduser("~/privacy_buffer"), exist_ok=True)
    ts = payload["timestamp"].replace(":", "-")
    path = os.path.expanduser(f"~/privacy_buffer/{payload['type']}_{ts}.json")
    with open(path, "w") as f:
        json.dump(payload, f)

def flush_buffer():
    buf_dir = os.path.expanduser("~/privacy_buffer")
    if not os.path.exists(buf_dir):
        return
    for fname in os.listdir(buf_dir):
        fpath = os.path.join(buf_dir, fname)
        with open(fpath) as f:
            payload = json.load(f)
        try:
            r = requests.post(WORKER_URL, json=payload, timeout=15)
            if r.status_code == 200:
                os.remove(fpath)
                print(f"Flushed: {fname}")
        except:
            pass

MODE = sys.argv[1] if len(sys.argv) > 1 else "all"

flush_buffer()

if MODE in ("all", "permissions"):
    send("permission_snapshot", collect_permissions())

if MODE in ("all", "network"):
    send("network_log", collect_network())

if MODE in ("all", "apps"):
    send("app_audit", collect_apps())
PYEOF`
      },
      {
        label: "Make executable",
        code: `chmod +x ~/collect.py`
      }
    ]
  },
  {
    id: 3,
    title: "Step 3 — Set Your Worker URL",
    subtitle: "Replace with your actual Cloudflare Worker URL",
    blocks: [
      {
        label: "Edit the URL in collect.py",
        code: `sed -i 's|https://privacy-ingest.YOUR_SUBDOMAIN.workers.dev|YOUR_ACTUAL_WORKER_URL|g' ~/collect.py`
      }
    ]
  },
  {
    id: 4,
    title: "Step 4 — Test It",
    subtitle: "Run manually first to confirm it works",
    blocks: [
      {
        label: "Test permissions collection",
        code: `python3 ~/collect.py permissions`
      },
      {
        label: "Test network collection",
        code: `python3 ~/collect.py network`
      },
      {
        label: "Test app audit",
        code: `python3 ~/collect.py apps`
      },
      {
        label: "Run everything at once",
        code: `python3 ~/collect.py all`
      }
    ]
  },
  {
    id: 5,
    title: "Step 5 — Set Up Cron (Auto-Run)",
    subtitle: "Start cron daemon + schedule jobs",
    blocks: [
      {
        label: "Start cron daemon",
        code: `crond`
      },
      {
        label: "Write crontab (paste entire block)",
        code: `crontab - << 'CRONEOF'
# Permissions — daily 2am
0 2 * * * python3 /data/data/com.termux/files/home/collect.py permissions >> /data/data/com.termux/files/home/logs/collect.log 2>&1

# Network — every 4 hours
0 */4 * * * python3 /data/data/com.termux/files/home/collect.py network >> /data/data/com.termux/files/home/logs/collect.log 2>&1

# App audit — Sunday 3am
0 3 * * 0 python3 /data/data/com.termux/files/home/collect.py apps >> /data/data/com.termux/files/home/logs/collect.log 2>&1
CRONEOF`
      },
      {
        label: "Verify crontab saved",
        code: `crontab -l`
      }
    ]
  },
  {
    id: 6,
    title: "Step 6 — Keep Cron Alive",
    subtitle: "Termux kills background processes — this fixes it",
    blocks: [
      {
        label: "Create boot script (Termux:Boot app required)",
        code: `mkdir -p ~/.termux/boot
cat > ~/.termux/boot/start-cron.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/sh
crond
EOF
chmod +x ~/.termux/boot/start-cron.sh`
      },
      {
        label: "Disable battery optimization for Termux",
        subtitle: "Run this — then go to Android Settings and allow",
        code: `termux-wake-lock`
      }
    ]
  },
  {
    id: 7,
    title: "Step 7 — View Logs",
    subtitle: "Check what's been collected and sent",
    blocks: [
      {
        label: "View collection log",
        code: `tail -50 ~/logs/collect.log`
      },
      {
        label: "View buffered (unsent) files",
        code: `ls -la ~/privacy_buffer/`
      },
      {
        label: "View a buffered file",
        code: `cat ~/privacy_buffer/*.json | python3 -m json.tool | head -100`
      },
      {
        label: "Check cron is running",
        code: `ps aux | grep crond`
      }
    ]
  }
];

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      style={{
        background: copied ? "#00ff88" : "#1a1a2e",
        color: copied ? "#000" : "#00ff88",
        border: `1px solid ${copied ? "#00ff88" : "#00ff8844"}`,
        borderRadius: "4px",
        padding: "6px 14px",
        fontSize: "11px",
        fontFamily: "monospace",
        cursor: "pointer",
        letterSpacing: "0.05em",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
        minWidth: "70px"
      }}
    >
      {copied ? "✓ COPIED" : "COPY"}
    </button>
  );
}

function CodeBlock({ label, code, subtitle }) {
  return (
    <div style={{
      marginBottom: "16px",
      border: "1px solid #1e2040",
      borderRadius: "6px",
      overflow: "hidden"
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: "#0d0d1a",
        padding: "8px 12px",
        borderBottom: "1px solid #1e2040"
      }}>
        <div>
          <span style={{ color: "#6b7db3", fontSize: "11px", fontFamily: "monospace", letterSpacing: "0.05em" }}>
            {label}
          </span>
          {subtitle && (
            <span style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", marginLeft: "8px" }}>
              — {subtitle}
            </span>
          )}
        </div>
        <CopyButton text={code} />
      </div>
      <pre style={{
        margin: 0,
        padding: "14px",
        background: "#080810",
        color: "#c8d3f5",
        fontSize: "12px",
        fontFamily: "'Courier New', monospace",
        lineHeight: "1.6",
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all"
      }}>
        {code}
      </pre>
    </div>
  );
}

export default function App() {
  const [activeStep, setActiveStep] = useState(null);

  return (
    <div style={{
      background: "#05050f",
      minHeight: "100vh",
      fontFamily: "monospace",
      padding: "16px",
      maxWidth: "800px",
      margin: "0 auto"
    }}>
      {/* Header */}
      <div style={{ marginBottom: "24px", borderBottom: "1px solid #1e2040", paddingBottom: "16px" }}>
        <div style={{ color: "#00ff88", fontSize: "11px", letterSpacing: "0.15em", marginBottom: "4px" }}>
          SAMSUNG GALAXY S26 // TERMUX
        </div>
        <div style={{ color: "#fff", fontSize: "20px", fontWeight: "bold", marginBottom: "4px" }}>
          Privacy Collector Setup
        </div>
        <div style={{ color: "#4a5580", fontSize: "11px" }}>
          7 steps — run in order — tap COPY then paste into Termux
        </div>
      </div>

      {/* Steps */}
      {steps.map((step) => {
        const isOpen = activeStep === step.id;
        return (
          <div key={step.id} style={{ marginBottom: "12px" }}>
            <button
              onClick={() => setActiveStep(activeStep === step.id ? null : step.id)}
              style={{
                width: "100%",
                background: isOpen ? "#0d0d2a" : "#080812",
                border: `1px solid ${isOpen ? "#2a2a60" : "#1a1a30"}`,
                borderRadius: "6px",
                padding: "12px 16px",
                cursor: "pointer",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                borderBottomLeftRadius: isOpen ? "0" : "6px",
                borderBottomRightRadius: isOpen ? "0" : "6px",
              }}
            >
              <span style={{
                background: "#00ff8822",
                color: "#00ff88",
                border: "1px solid #00ff8844",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "11px",
                fontWeight: "bold",
                minWidth: "24px",
                textAlign: "center"
              }}>
                {step.id}
              </span>
              <div>
                <div style={{ color: "#e0e8ff", fontSize: "13px", fontWeight: "bold" }}>{step.title}</div>
                <div style={{ color: "#4a5580", fontSize: "11px", marginTop: "2px" }}>{step.subtitle}</div>
              </div>
              <span style={{ marginLeft: "auto", color: "#3a4060", fontSize: "16px" }}>
                {isOpen ? "▲" : "▼"}
              </span>
            </button>

            {isOpen && (
              <div style={{
                border: "1px solid #2a2a60",
                borderTop: "none",
                borderBottomLeftRadius: "6px",
                borderBottomRightRadius: "6px",
                padding: "14px",
                background: "#080812"
              }}>
                {step.blocks.map((block, i) => (
                  <CodeBlock key={i} label={block.label} code={block.code} subtitle={block.subtitle} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Footer note */}
      <div style={{
        marginTop: "24px",
        padding: "12px",
        border: "1px solid #1a1a30",
        borderRadius: "6px",
        background: "#080812"
      }}>
        <div style={{ color: "#00ff88", fontSize: "10px", marginBottom: "6px", letterSpacing: "0.1em" }}>
          ⚠ BEFORE YOU START
        </div>
        <div style={{ color: "#4a5580", fontSize: "11px", lineHeight: "1.7" }}>
          1. Install Termux from <span style={{ color: "#6b7db3" }}>F-Droid</span> (not Play Store){"\n"}
          2. Install <span style={{ color: "#6b7db3" }}>Termux:Boot</span> from F-Droid (for Step 6){"\n"}
          3. Deploy your Cloudflare Worker first — you'll need the URL for Step 3{"\n"}
          4. After Step 6, go to Android Settings → Apps → Termux → Battery → Unrestricted
        </div>
      </div>
    </div>
  );
}
