import { Eraser } from "lucide-react";

export default function TopBar({ isExporting, onClearReport }) {
  return (
    <div className="topBarSimple">
      <h2 className="appTitle">SYTCORE Daily Report</h2>

      <button
        className="btnDanger"
        onClick={onClearReport}
        disabled={isExporting}
        type="button"
      >
        <Eraser size={16} />
        Clear Report
      </button>
    </div>
  );
}
