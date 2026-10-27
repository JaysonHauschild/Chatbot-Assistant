function ChatInput({
  t,
  canInteractWithChat,
  conversationExpiredNotice,
  input,
  isSending,
  maxMessageLength,
  onInputChange,
  onSubmit,
  onTextareaKeyDown,
  textareaRef,
}) {
  return (
    <form className="chat-input-row" onSubmit={onSubmit}>
      <textarea
        ref={textareaRef}
        rows={2}
        aria-label={t('Type your message')}
        placeholder={t(conversationExpiredNotice ? 'Start a new chat to continue' : 'Type your message')}
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={onTextareaKeyDown}
        maxLength={maxMessageLength}
        disabled={isSending || !canInteractWithChat || Boolean(conversationExpiredNotice)}
      />
      <button
        type="submit"
        className="send-btn"
        aria-label={t('Send message')}
        disabled={isSending || input.trim().length === 0 || !canInteractWithChat || Boolean(conversationExpiredNotice)}
      >
        <i className="fa-solid fa-arrow-right-long"></i>
      </button>
      <div className="chat-secondary-actions" />
      <p
        className={`chat-input-counter ${input.length >= maxMessageLength - 100 ? 'near-limit' : ''}`}
        aria-live="polite"
      >
        {input.length}/{maxMessageLength}
      </p>
    </form>
  )
}

export default ChatInput
