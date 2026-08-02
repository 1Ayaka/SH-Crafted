import { el } from './ui.js';
import { isAdmin } from './admin.js';

function announce(message, error = false) {
  const root = document.getElementById('toast-root');
  root.querySelector('.admin-save-toast')?.remove();
  const toast = el('div', { class: `admin-save-toast${error ? ' error' : ''}`, role: 'status', text: message });
  root.appendChild(toast);
  setTimeout(() => toast.remove(), error ? 6000 : 2400);
}

export function mountEditableModule(container, fields, saveValues) {
  if (!isAdmin() || !container || !fields.length) return () => {};
  container.classList.add('admin-editable-module');
  let editing = false;
  let originals = new Map();

  const editButton = el('button', { class: 'admin-module-edit', type: 'button', text: '编辑' });
  const saveButton = el('button', { class: 'admin-module-save', type: 'button', text: '保存', hidden: 'hidden' });
  const cancelButton = el('button', { class: 'admin-module-cancel', type: 'button', text: '取消', hidden: 'hidden' });
  const tools = el('div', { class: 'admin-module-tools' }, [editButton, saveButton, cancelButton]);
  container.appendChild(tools);

  const setEditing = (value) => {
    editing = value;
    container.classList.toggle('is-admin-editing', value);
    editButton.hidden = value;
    saveButton.hidden = !value;
    cancelButton.hidden = !value;
    for (const field of fields) {
      field.element.contentEditable = value ? 'true' : 'false';
      field.element.spellcheck = value;
      field.element.classList.toggle('admin-inline-input', value);
    }
    if (value) fields[0].element.focus();
  };

  editButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    originals = new Map(fields.map((field) => [field.key, field.element.textContent]));
    setEditing(true);
  });
  cancelButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    for (const field of fields) field.element.textContent = originals.get(field.key) ?? '';
    setEditing(false);
  });
  saveButton.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!editing) return;
    saveButton.disabled = true;
    saveButton.textContent = '保存中';
    const values = Object.fromEntries(fields.map((field) => [field.key, field.element.textContent.trim()]));
    try {
      await saveValues(values);
      setEditing(false);
      announce('内容已保存');
      setTimeout(() => location.reload(), 350);
    } catch (error) {
      announce(error.message, true);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = '保存';
    }
  });

  const stopEditableLinks = (event) => {
    if (editing && event.target.closest('a, button') && !event.target.closest('.admin-module-tools')) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  container.addEventListener('click', stopEditableLinks, true);
  return () => container.removeEventListener('click', stopEditableLinks, true);
}

export function adminNotice(message, error = false) {
  announce(message, error);
}
