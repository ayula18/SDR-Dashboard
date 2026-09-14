import { fmtInt } from '@/lib/client/format';
import { accessor } from './scale';

/** The table view behind a chart: the same numbers, readable without hovering. */
export default function ChartTable({ rows = [], x = 'label', xLabel = 'Period', series = [], format = fmtInt }) {
  const label = accessor(x);
  return (
    <div className="dt-scroll">
      <table className="data-table dense">
        <thead>
          <tr>
            <th scope="col">{xLabel}</th>
            {series.map(s => <th key={s.key} scope="col" className="num">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>{label(row)}</td>
              {series.map(s => <td key={s.key} className="num">{format(row[s.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
