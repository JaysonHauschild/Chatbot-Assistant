import { useId, useState } from 'react'

function RuleCategoryTags({ label, value, suggestions, onChange, disabled }) {
  const id = useId()
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const options = suggestions.filter((tag) => !value.some((selected) => selected.toLowerCase() === tag.toLowerCase())
    && tag.toLowerCase().includes(input.trim().toLowerCase()))
  const add = (text) => {
    const tag = text.trim().toLowerCase().replace(/[\s-]+/g, '_')
    if (tag && !value.some((selected) => selected.toLowerCase() === tag)) onChange([...value, tag])
    setInput('')
    setActive(-1)
  }

  return <div className="rule-category-field">
    <label htmlFor={id}>{label}</label>
    <div className="rule-category-tags" aria-label={`${label} tags`}>
      {value.map((tag) => <span className="rule-category-tag" key={tag}>
        {tag}<button type="button" disabled={disabled} aria-label={`Remove ${tag} from ${label}`}
          onClick={() => onChange(value.filter((selected) => selected !== tag))}>×</button>
      </span>)}
    </div>
    <div className="rule-category-picker">
      <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open && !disabled}
        aria-controls={`${id}-options`} aria-describedby={`${id}-help`}
        aria-activedescendant={open && active >= 0 && options[active] ? `${id}-option-${active}` : undefined}
        value={input} disabled={disabled} placeholder="Choose a category or type a new one"
        onFocus={() => setOpen(true)}
        onBlur={() => { add(input); setOpen(false) }}
        onChange={(event) => { setInput(event.target.value); setActive(-1); setOpen(true) }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
            if (options.length) setActive((current) => event.key === 'ArrowDown' ? (current + 1) % options.length : (current <= 0 ? options.length - 1 : current - 1))
          } else if (event.key === 'Enter' || event.key === 'Tab') {
            if (event.key === 'Enter') event.preventDefault()
            add(open && active >= 0 && options[active] ? options[active] : input)
            setOpen(false)
          } else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1) }
        }} />
      {open && !disabled && <ul id={`${id}-options`} role="listbox" aria-label={`Existing ${label}`} className="rule-category-options">
        {options.map((tag, index) => <li role="presentation" key={tag}>
          <button id={`${id}-option-${index}`} type="button" role="option" aria-selected={active === index}
            tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => { add(tag); setOpen(false) }}>{tag}</button>
        </li>)}
        {options.length === 0 && <li role="presentation" className="rule-category-option-note">{input.trim() ? 'Press Enter or Tab to add this category.' : 'Type a new category to add it.'}</li>}
      </ul>}
    </div>
    <p id={`${id}-help`} className="dashboard-blocked-description">Select an existing category, or type a new one and press Enter or Tab. Remove a category with ×.</p>
  </div>
}

export default RuleCategoryTags
