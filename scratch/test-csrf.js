const http = require('http');

async function test() {
  console.log("Fetching CSRF token...");
  const csrfRes = await fetch("http://localhost:3000/api/auth/csrf", {
    headers: {
      "Origin": "http://localhost:3000"
    }
  });
  
  console.log("CSRF status:", csrfRes.status);
  const cookies = csrfRes.headers.get("set-cookie");
  console.log("Cookies:", cookies);
  
  const csrfBody = await csrfRes.json();
  console.log("CSRF Body:", csrfBody);
  
  if (!csrfBody.data) {
    console.error("Failed to get CSRF data");
    return;
  }
  
  console.log("Sending Login request...");
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: {
      "Origin": "http://localhost:3000",
      "Content-Type": "application/json",
      "Cookie": cookies || "",
      "x-csrf-token": csrfBody.data.token
    },
    body: JSON.stringify({
      username: "admin",
      password: "password123" // whatever
    })
  });
  
  console.log("Login status:", loginRes.status);
  const loginBody = await loginRes.json();
  console.log("Login Body:", loginBody);
}

test().catch(console.error);
