const input = document.getElementById('query');
const count = document.getElementById('count');
const send = (type, extra) => window.findBar.send({ type, ...extra });

input.addEventListener('input', () => send('query', { text: input.value }));
input.addEventListener('keydown', (event) => {
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
