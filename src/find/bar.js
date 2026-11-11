const input = document.getElementById('query');
const count = document.getElementById('count');
const send = (type, extra) => window.findBar.send({ type, ...extra });

const [next, previous] = window.findBar.platform === 'darwin' ? ['Cmd+G', 'Shift+Cmd+G'] : ['Ctrl+G', 'Ctrl+Shift+G'];
document.getElementById('previous').title = `Previous (${previous})`;
document.getElementById('next').title = `Next (${next})`;

input.addEventListener('input', () => send('query', { text: input.value }));
input.addEventListener('keydown', (event) => {
  // Enter that commits an IME composition belongs to the composition.
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter') send(event.shiftKey ? 'previous' : 'next');
  else if (event.key === 'Escape') send('close');
  else return;
  event.preventDefault();
});
document.getElementById('bar').addEventListener('submit', (event) => event.preventDefault());
document.getElementById('previous').addEventListener('click', () => send('previous'));
document.getElementById('next').addEventListener('click', () => send('next'));
document.getElementById('close').addEventListener('click', () => send('close'));

// Each time the bar takes focus the last query is selected, so typing replaces it.
window.addEventListener('focus', () => {
  input.focus();
  input.select();
});

window.findBar.onState((state) => {
  count.textContent = state.label;
  document.body.classList.toggle('empty', state.label === 'No results');
});
