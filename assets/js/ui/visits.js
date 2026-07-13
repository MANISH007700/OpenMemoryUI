/* Landing counter: counts one visit per browser session via the same free
   Abacus counter API the clap button uses. No cookies, no fingerprinting -
   just an anonymous global tally shown in the footer. */

import { $ } from "../utils.js";

const COUNTER_URL = "https://abacus.jasoncameron.dev";
const COUNTER_PATH = "openmemoryui/visits";
const SESSION_KEY = "glassbox.visited";

function render(n) {
  $("#visitCount").textContent = n != null ? n.toLocaleString() : "";
}

export async function initVisits() {
  try {
    if (!sessionStorage.getItem(SESSION_KEY)) {
      sessionStorage.setItem(SESSION_KEY, "1");
      const res = await fetch(`${COUNTER_URL}/hit/${COUNTER_PATH}`);
      if (res.ok) render((await res.json()).value);
    } else {
      const res = await fetch(`${COUNTER_URL}/get/${COUNTER_PATH}`);
      if (res.ok) render((await res.json()).value);
    }
  } catch (e) {} // counter is decorative - never let it break the app
}
