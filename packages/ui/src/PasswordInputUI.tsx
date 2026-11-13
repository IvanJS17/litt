import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "use-intl";
import { InputUI } from "./InputUI";

/** A password field with its own show / hide toggle. Each instance keeps its
 * own state, so a password and its confirmation reveal independently. */
export function PasswordInputUI({
  className,
  ...props
}: Omit<ComponentProps<"input">, "type">) {
  const t = useTranslations();
  const [visible, setVisible] = useState(false);
  const label = visible ? t("ui.passwordInput.hide") : t("ui.passwordInput.show");
  return (
    <div className="relative">
      <InputUI
        {...props}
        type={visible ? "text" : "password"}
        className={`${className ?? ""} pr-10`}
      />
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={visible}
        disabled={props.disabled}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-500 transition-colors hover:text-gray-950 disabled:opacity-50"
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Eye aria-hidden="true" className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
