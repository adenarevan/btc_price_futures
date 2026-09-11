const assert = require("assert");

function passwordPolicy(current, next, confirmation) {
  if (
    next !== confirmation ||
    next === current ||
    next.length < 15 ||
    next.length > 128 ||
    /^(password|qwerty|admin|123456|letmein|iloveyou)[\W\d]*$/i.test(next) ||
    new Set(next.toLowerCase()).size < 6
  ) {
    throw new Error("PASSWORD_POLICY");
  }
}

try {
  passwordPolicy("oldpass", "adminganTENG12345678!@#", "adminganTENG12345678!@#");
  console.log("PASS");
} catch (e) {
  console.error("FAIL", e.message);
}
