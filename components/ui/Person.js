import Link from 'next/link';

function initialsOf(name) {
  const words = String(name || '?').trim().split(/\s+/);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0].slice(0, 2)).toUpperCase();
}

/** Initials in text ink; the team colour is only the ring and wash, never the text. */
export function Avatar({ name, color = 'var(--viz-neutral)', size = 26 }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        color: 'var(--text-primary)',
        background: `color-mix(in oklab, ${color} 22%, transparent)`,
        boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${color} 60%, transparent)`,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

export function Person({ name, color, href, size }) {
  const content = (
    <>
      <Avatar name={name} color={color} size={size} />
      <span>{name}</span>
    </>
  );
  return href ? <Link className="person" href={href}>{content}</Link> : <span className="person">{content}</span>;
}
