/** Small status label. Tones: neutral (default), good, bad, warn, accent. */
export default function Badge({ tone = 'neutral', icon: Icon, title, children }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {Icon && <Icon aria-hidden="true" />}
      {children}
    </span>
  );
}
