#!/usr/bin/env node
import { spawn } from "child_process";
import qrcodeTerminal from "qrcode-terminal";
import fs from "fs";

const DEFAULT_PORT = 3119;

function showHelp() {
  console.log(`
Usage: openmote [options]

Options:
  --bare-bones      Use opencode web instead of custom server
  --bare            Local network only (no auth required)
  --tunnel <type>    Public URL via tailscale/ngrok/cloudflare
  --caffeinate      Prevent system sleep while running
  --login <str>     Auth for both username and password (required for tunnel mode)
  --port <n>        Server port (default: ${DEFAULT_PORT})
  --help            Show this help
`);
  process.exit(0);
}

function parseArgs(args) {
  const result = {
    bareBones: false,
    bare: false,
    tunnel: null,
    caffeinate: false,
    login: null,
    port: DEFAULT_PORT,
  };

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") showHelp();
    if (arg === "--bare-bones") result.bareBones = true;
    if (arg === "--bare") result.bare = true;
    if (arg === "--caffeinate") result.caffeinate = true;
    if (arg === "--tunnel") {
      const val = args[++i];
      if (val && ["tailscale", "ngrok", "cloudflare"].includes(val)) {
        result.tunnel = val;
      } else {
        console.error("Error: --tunnel requires 'tailscale', 'ngrok', or 'cloudflare'");
        process.exit(1);
      }
    }
    if (arg === "--login") {
      result.login = args[++i];
    }
    if (arg === "--port") {
      const val = parseInt(args[++i], 10);
      if (isNaN(val)) {
        console.error("Error: --port requires a number");
        process.exit(1);
      }
      result.port = val;
    }
  }

  // Backwards compatibility: support --password as an alias for --login
  if (args.includes("--password")) {
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--password") {
        result.login = args[++i];
        break;
      }
    }
  }

  if (result.tunnel && !result.login) {
    console.error("Error: --login is required when using --tunnel");
    process.exit(1);
  }

  return result;
}

function getLocalIP() {
  return new Promise((resolve) => {
    const isMac = process.platform === "darwin";
    if (isMac) {
      const proc = spawn("ipconfig", ["getifaddr", "en0"]);
      let output = "";
      proc.stdout.on("data", (d) => (output += d.toString()));
      proc.on("close", () => resolve(output.trim() || "127.0.0.1"));
    } else {
      const proc = spawn("sh", ["-c", "ip route | grep -oP 'src \\K[^ ]+' | head -1"]);
      let output = "";
      proc.stdout.on("data", (d) => (output += d.toString()));
      proc.on("close", () => resolve(output.trim() || "127.0.0.1"));
    }
  });
}

function checkTunnelBinary(tunnelType) {
  return new Promise((resolve, reject) => {
    const binary = tunnelType === "tailscale" ? "tailscale" : tunnelType === "ngrok" ? "ngrok" : "cloudflared";
    const proc = spawn("sh", ["-c", `command -v ${binary}`]);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(true);
      } else if (tunnelType === "tailscale" && process.platform === "darwin") {
        const appPath = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
        if (fs.existsSync(appPath)) {
          resolve(true);
        } else {
          reject(new Error(`tailscale CLI not found. Install via: brew install tailscale`));
        }
      } else {
        reject(new Error(`${binary} not found. Install it first to use --tunnel ${tunnelType}.`));
      }
    });
  });
}

function getTunnelBinary(tunnelType) {
  if (tunnelType === "tailscale" && process.platform === "darwin") {
    const appPath = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
    if (fs.existsSync(appPath)) return appPath;
  }
  return tunnelType;
}

function getTailscaleFQDN() {
  return new Promise((resolve) => {
    const binary = getTunnelBinary("tailscale");
    const proc = spawn(binary, ["status", "--json"]);
    let output = "";
    proc.stdout?.on("data", (d) => (output += d.toString()));
    proc.on("close", () => {
      try {
        const data = JSON.parse(output);
        const fqdn = data.Self?.DNSName?.replace(/\.$/, "") || "";
        resolve(fqdn ? fqdn : null);
      } catch {
        resolve(null);
      }
    });
    proc.on("error", () => resolve(null));
  });
}

function startTunnel(tunnelType, port, fqdn) {
  return new Promise((resolve) => {
    let proc, urlResolved = false;
    const binary = getTunnelBinary(tunnelType);

    if (tunnelType === "ngrok") {
      proc = spawn("ngrok", ["http", String(port)]);
      proc.stdout.on("data", (d) => {
        const str = d.toString();
        const match = str.match(/https:\/\/[a-z0-9-]+\.ngrok\.(io|app)/);
        if (match && !urlResolved) {
          urlResolved = true;
          resolve({ url: match[0], proc });
        }
      });
    } else if (tunnelType === "cloudflare") {
      proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`]);
      proc.stdout.on("data", (d) => {
        const str = d.toString();
        const match = str.match(/https:\/\/[a-z0-9-]+\.(trycloudflare\.com|workers\.dev)/);
        if (match && !urlResolved) {
          urlResolved = true;
          resolve({ url: match[0], proc });
        }
      });
    } else {
      const tunnelURL = fqdn ? `https://${fqdn}` : `https://openmote.ts.net`;
      proc = spawn(binary, ["funnel", "--bg", String(port)]);
      setTimeout(() => {
        if (!urlResolved) resolve({ url: tunnelURL, proc });
      }, 2000);
    }

    proc.on("error", () => {});
    proc.stderr?.on("data", () => {});
  });
}

function generateQR(text) {
  return new Promise((resolve) => {
    qrcodeTerminal.generate(text, { small: true }, (qr) => {
      resolve(qr);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const localIP = await getLocalIP();
  const localURL = `http://${localIP}:${args.port}`;

  let tunnelProc = null;
  let tunnelURL = null;
  let tsFQDN = null;

  if (args.tunnel === "tailscale") {
    tsFQDN = await getTailscaleFQDN();
  }

  if (args.tunnel) {
    try {
      await checkTunnelBinary(args.tunnel);
      const result = await startTunnel(args.tunnel, args.port, tsFQDN);
      tunnelProc = result.proc;
      tunnelURL = result.url;
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  }

  const serverEnv = { ...process.env };
  if (args.tunnel && args.login) {
    // Set both username and password to the same value for easier mobile auth
    serverEnv.OPENCODE_SERVER_USERNAME = args.login;
    serverEnv.OPENCODE_SERVER_PASSWORD = args.login;
  } else if (!args.bare && !args.bareBones) {
    console.error("Warning: Server is unsecured. Use --bare for local-only or --tunnel with --login for public access.");
  }

  const serverArgs = args.bareBones
    ? ["web", `--hostname=0.0.0.0`, `--port=${args.port}`]
    : ["serve", `--hostname=0.0.0.0`, `--port=${args.port}`];

  const buildCmd = (base) => {
    if (!args.caffeinate) return base;
    const isMac = process.platform === "darwin";
    if (isMac) return ["caffeinate", "-i", "-s", ...base];
    return ["systemd-inhibit", "--what=idle", "--mode=block", base[0], ...base.slice(1)];
  };

  const cmd = buildCmd(["opencode", ...serverArgs]);

  const displayURL = tunnelURL || localURL;
  const qr = await generateQR(displayURL);

  console.log(qr);
  console.log("");

  const boxWidth = 50;
  const top = "┌" + "─".repeat(boxWidth) + "┐";
  const bottom = "└" + "─".repeat(boxWidth) + "┘";

  const lines = [
    "OpenMote Remote Ready",
    "",
    `Local:   ${localURL}`,
    ...(tunnelURL ? [`Remote:  ${tunnelURL}`] : []),
    ...(args.tunnel ? [`Username: ${args.login}`] : []),
    ...(args.tunnel ? [`Password: ${args.login}`] : []),
    "",
    "Same value for both fields on mobile",
  ];

  console.log(top);
  for (const line of lines) {
    const padding = Math.max(0, boxWidth - line.length - 1);
    console.log("│ " + line + " ".repeat(padding));
  }
  console.log(bottom);
  console.log("");

  const serverProc = spawn(cmd[0], cmd.slice(1), { env: serverEnv });

  const cleanup = () => {
    serverProc.kill();
    if (tunnelProc) tunnelProc.kill();
  };

  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});