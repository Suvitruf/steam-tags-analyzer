import type { Tag } from '../types';

/** Native datalist search, explicit add/remove buttons and exact taxonomy IDs. */
export function createTagChoices(host: HTMLElement, tags: Tag[]) {
  const active = tags.filter(t => t.is_active === 1);
  const byName = new Map(active.map(t => [t.name.toLowerCase(), t]));
  const selected = { included: new Map<number, Tag>(), excluded: new Map<number, Tag>() };
  host.innerHTML = `
    <p class="tag-choices-help">Optional tag choices. Mark what is present in your game or choose exact tags to leave out. Related tags are not selected or excluded automatically.</p>
    <datalist id="steam-tag-choices"></datalist>
    <div class="form-row">
      <fieldset class="tag-choice-group" data-kind="included">
        <legend>Present in my game</legend>
        <label class="sr-only" for="included-tag-search">Find a tag present in your game</label>
        <div class="tag-choice-input"><input id="included-tag-search" type="text" list="steam-tag-choices" placeholder="Search Steam tags" autocomplete="off"><button type="button">Add</button></div>
        <ul class="tag-choices-selected" aria-label="Tags marked present"></ul>
      </fieldset>
      <fieldset class="tag-choice-group" data-kind="excluded">
        <legend>Do not suggest</legend>
        <label class="sr-only" for="excluded-tag-search">Find a tag to exclude</label>
        <div class="tag-choice-input"><input id="excluded-tag-search" type="text" list="steam-tag-choices" placeholder="Search Steam tags" autocomplete="off"><button type="button">Add</button></div>
        <ul class="tag-choices-selected" aria-label="Excluded tags"></ul>
      </fieldset>
    </div>
    <p class="tag-choices-message" role="status" aria-live="polite"></p>`;
  const options = host.querySelector('datalist')!;
  for (const tag of active) {
    const option = document.createElement('option');
    option.value = tag.name;
    options.append(option);
  }
  const message = host.querySelector<HTMLElement>('.tag-choices-message')!;
  const fields = [...host.querySelectorAll<HTMLFieldSetElement>('fieldset')];
  for (const field of fields) {
    const kind = field.dataset.kind as keyof typeof selected;
    const other = kind === 'included' ? 'excluded' : 'included';
    const input = field.querySelector('input')!;
    const list = field.querySelector('ul')!;
    const add = () => {
      const tag = byName.get(input.value.trim().toLowerCase());
      if (!tag) { message.textContent = 'Choose an existing Steam tag from the suggestions.'; input.focus(); return; }
      if (selected[other].has(tag.tag_id)) {
        message.textContent = `"${tag.name}" is already ${other === 'included' ? 'marked present' : 'excluded'}. Remove it from that list first.`;
        input.focus(); return;
      }
      if (!selected[kind].has(tag.tag_id)) {
        selected[kind].set(tag.tag_id, tag);
        const item = document.createElement('li'), remove = document.createElement('button');
        item.append(document.createTextNode(tag.name));
        remove.type = 'button'; remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${tag.name}`);
        remove.addEventListener('click', () => {
          selected[kind].delete(tag.tag_id); item.remove();
          message.textContent = `Removed ${tag.name}.`; input.focus();
        });
        item.append(remove); list.append(item);
      }
      message.textContent = `${tag.name} ${kind === 'included' ? 'marked present' : 'excluded'}.`;
      input.value = ''; input.focus();
    };
    field.querySelector('button')!.addEventListener('click', add);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); add(); }
    });
  }
  return {
    values() {
      const pending = fields.map(f => f.querySelector('input')!).find(input => input.value.trim());
      if (pending) {
        const error = 'Add or clear the tag in the search field before analyzing.';
        message.textContent = error; pending.focus(); throw new Error(error);
      }
      return { includedTagIds: [...selected.included.keys()], excludedTagIds: [...selected.excluded.keys()] };
    },
    setDisabled(disabled: boolean) { for (const field of fields) field.disabled = disabled; },
  };
}
