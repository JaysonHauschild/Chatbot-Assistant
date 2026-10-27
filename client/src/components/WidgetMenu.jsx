function WidgetMenu({
  t,
  language,
  onLanguageChange,
  fontSizes,
  fontSize,
  onCycleFontSize,
  onResetChat,
  onToggleTheme,
  setIsWidgetMenuOpen,
  theme,
  widgetMenuRef,
}) {
  return (
    <div ref={widgetMenuRef} className="chat-context-menu" role="menu" aria-label={t("Chat options")}>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onResetChat()
        }}
      >
        {t("Reset Chat")}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={theme === 'dark'}
        className="chat-context-menu-theme-btn"
        onClick={() => {
          onToggleTheme()
          setIsWidgetMenuOpen(false)
        }}
      >
        <span>{t("Dark Mode")}</span>
        <i
          className={`fa-solid ${theme === 'dark' ? 'fa-toggle-on' : 'fa-toggle-off'}`}
          aria-hidden="true"
        />
      </button>
      <label className="chat-context-menu-language">
        <span className="chat-context-menu-font-size-label">{t('Language')}</span>
        <select value={language} onChange={(event) => onLanguageChange(event.target.value)}>
          <option value="en" lang="en">English</option>
          <option value="es" lang="es">Español</option>
          <option value="fr" lang="fr">Français</option>
        </select>
      </label>
      <div className="chat-context-menu-font-size" role="group" aria-label={t("Font size")}>
        <span className="chat-context-menu-font-size-label">{t("Font Size")}</span>
        <div className="chat-context-menu-font-size-btns">
          {fontSizes.map((size) => (
            <button
              key={size}
              type="button"
              role="menuitemradio"
              aria-checked={fontSize === size}
              className={`chat-context-menu-font-size-btn${fontSize === size ? ' active' : ''}`}
              onClick={() => onCycleFontSize(size)}
            >
              {t(size.charAt(0).toUpperCase() + size.slice(1))}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default WidgetMenu
