import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect } from "react";

function lockScroll() {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
}

function unlockScroll() {
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
}


export default function SortableSheetPhoto({ photo, onRemove, disabled }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: photo.id, disabled });

    useEffect(() => {
        if (!isDragging) return;

        const preventScroll = (e) => e.preventDefault();

        document.addEventListener("touchmove", preventScroll, { passive: false });
        lockScroll();

        return () => {
            document.removeEventListener("touchmove", preventScroll);
            unlockScroll();
        };
    }, [isDragging]);


    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "grab",
    };

    return (
        <div ref={setNodeRef} style={style} className="sheetPhotoThumb">
            <img src={photo.url} alt="photo" />

            <button
                type="button"
                className="sheetRemovePhotoBtn"
                onClick={() => onRemove(photo)}
                aria-label="Remove photo"
            >
                <span className="sheetRemoveX">×</span>

            </button>


            {/* drag handle */}
            <div
                className="sheetDragHandle"
                {...attributes}
                {...listeners}
                style={{ opacity: disabled ? 0.4 : 1 }}
            >
                ⠿
            </div>

        </div>
    );
}
