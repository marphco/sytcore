import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X } from "lucide-react";

export default function SortablePhoto({ photo, onRemove, disabled }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: photo.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: disabled ? "not-allowed" : "grab",
  };

  return (
    <div ref={setNodeRef} style={style} className="thumbWrap">
      <img className="thumb" src={photo.url} alt="photo" />

      <button
        type="button"
        className="thumbRemove"
        onClick={() => onRemove(photo)}
        aria-label="Remove photo"
        disabled={disabled}
      >
        <X size={16} />
      </button>

      <div
  className="dragHandle"
  {...attributes}
  {...listeners}
  onPointerDown={(e) => {
    if (disabled) return;
    lockBodyScroll();
    listeners?.onPointerDown?.(e);
  }}
  onPointerUp={() => unlockBodyScroll()}
  onPointerCancel={() => unlockBodyScroll()}
  style={{ opacity: disabled ? 0.5 : 1 }}
>
  ⠿
</div>

    </div>
  );
}
