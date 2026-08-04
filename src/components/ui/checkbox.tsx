import React from 'react';

/** Soft Windows-FM checkbox — accent check, no SaaS ping animation. */
export const Checkbox: React.FC<{
  label: React.ReactNode;
  checked?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}> = ({ label, checked = false, onChange, disabled = false }) => (
  <label
    className={`bndz-ui-checkbox group inline-flex items-start justify-start gap-[10px] my-[5px] cursor-pointer max-w-full ${
      disabled ? 'opacity-50 pointer-events-none' : ''
    }`}
  >
    <span className="relative mt-[1px] flex items-center justify-center shrink-0">
      <input
        type="checkbox"
        className="bndz-ui-checkbox-input peer"
        checked={checked}
        onChange={onChange || (() => {})}
        disabled={disabled}
      />
      <svg
        className="bndz-ui-checkbox-mark pointer-events-none absolute"
        viewBox="0 0 14 14"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <path
          d="M2.5 7.5L5.5 10.5L11.5 3.5"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
    <span className="bndz-ui-checkbox-label text-[12.5px] text-[#d1d5db] leading-snug select-none group-hover:text-white transition-colors">
      {label}
    </span>
  </label>
);
