const status = document.querySelector('#status');
const pairing = document.querySelector('#pairing');
const connected = document.querySelector('#connected');
const error = document.querySelector('#error');
const code = document.querySelector('#code');

chrome.runtime.sendMessage({ type: 'status' }, (result) => render(result || { paired: false, reachable: false }));
document.querySelector('#pair').addEventListener('click', pair);
code.addEventListener('keydown', (event) => { if (event.key === 'Enter') void pair(); });

function pair() {
  error.textContent = '';
  if (!/^\d{6}$/.test(code.value.trim())) { error.textContent = 'Enter the six-digit code.'; return; }
  chrome.runtime.sendMessage({ type: 'pair', code: code.value }, (result) => {
    if (result?.ok) render({ paired: true, reachable: true });
    else error.textContent = result?.error || 'Could not pair.';
  });
}

function render(result) {
  pairing.hidden = result.paired;
  connected.hidden = !result.paired;
  status.textContent = result.paired ? (result.reachable ? 'Desktop app connected' : 'Desktop app is offline') : 'Pair with the desktop app';
}
