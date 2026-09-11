import { existsSync, readFileSync } from "node:fs";
export function loadEnvironment() {
  if (existsSync(".env.local")) {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(".env.local");
    } else {
      const content = readFileSync(".env.local", "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1]!;
          let val = match[2] || "";
          if (val.startsWith('"') && val.endsWith('"')) {
            val = val.slice(1, -1).replace(/\\n/g, "\n");
          } else if (val.startsWith("'") && val.endsWith("'")) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) process.env[key] = val;
        }
      }
    }
  }
}
export async function hiddenPassword(
  label = "Password bootstrap: ",
): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("PRIVATE_TERMINAL_REQUIRED");
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.off("data", listen);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    function listen(chunk: string) {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          finish();
          reject(new Error("CANCELLED"));
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " " && value.length < 128) value += char;
      }
    }
    process.stdin.on("data", listen);
  });
}
