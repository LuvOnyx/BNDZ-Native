import React from 'react';

export const Checkbox: React.FC<{ label: React.ReactNode, checked?: boolean, onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void, disabled?: boolean }> = ({ label, checked = false, onChange, disabled = false }) => (
  <label className={`group flex items-center justify-start gap-[10px] my-[6px] cursor-pointer w-max ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
    <div className="relative flex items-center justify-center">
      <input 
        type="checkbox" 
        className="peer relative h-[18px] w-[18px] appearance-none rounded-[6px] border-[2px] border-[#444] bg-[#1a1a1a] outline-none transition-all duration-300 checked:border-[#22c55e] checked:bg-[#22c55e] hover:border-[#22c55e] hover:shadow-[0_0_10px_rgba(34,197,94,0.3)] cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111] focus-visible:ring-[#22c55e]" 
        checked={checked} 
        onChange={onChange || (() => {})} 
        disabled={disabled} 
      />
      <svg className="absolute w-[12px] h-[12px] pointer-events-none opacity-0 peer-checked:opacity-100 peer-checked:-rotate-0 -rotate-90 peer-checked:scale-100 scale-50 transition-all duration-300 text-[#111] drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)]" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {checked && <div className="absolute inset-0 rounded-[6px] animate-[ping_0.5s_cubic-bezier(0,0,0.2,1)_1] bg-[#22c55e] pointer-events-none opacity-50"></div>}
    </div>
    <span className="text-[13px] text-[#ccc] leading-tight select-none pt-[1px] group-hover:text-white transition-colors tracking-wide">{label}</span>
  </label>
);
