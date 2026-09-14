import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/** Page title, what the page answers, an optional way back, and meta on the right (sync time). */
export default function PageHeader({ title, description, back, meta, children }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {back && (
          <Link className="back-link" href={back.href}>
            <ArrowLeft aria-hidden="true" />{back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {children}
      </div>
      {meta && <div className="page-head-meta">{meta}</div>}
    </header>
  );
}
