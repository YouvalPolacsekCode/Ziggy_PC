export function initWaitlist() {
  const form = document.querySelector('.waitlist');
  const msg = document.createElement('p');
  msg.className = 'form-msg';
  msg.setAttribute('role', 'status');
  form.after(msg);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.textContent = 'כתובת אימייל לא תקינה 🤔';
      return;
    }
    msg.textContent = 'רגע…';
    try {
      await submitEmail(email);
      msg.textContent = 'נרשמתם! הקופסה מתקרבת 📦';
      form.email.value = '';
    } catch {
      msg.textContent = 'משהו השתבש — נסו שוב עוד רגע';
    }
  });
}

// Default implementation — localStorage simulation (same mechanism as old site)
// TODO-launch: connect real waitlist backend when endpoint is available
async function submitEmail(email) {
  await new Promise(r => setTimeout(r, 600));
  try {
    const list = JSON.parse(localStorage.getItem('ziggy-waitlist') || '[]');
    if (list.indexOf(email) === -1) list.push(email);
    localStorage.setItem('ziggy-waitlist', JSON.stringify(list));
  } catch (e) { /* storage unavailable, still show success */ }
  console.log('waitlist (simulated):', email);
}
