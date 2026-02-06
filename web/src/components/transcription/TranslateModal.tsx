import React from 'react';

interface TranslateModalProps {
  open: boolean;
  targetLanguage: string;
  onTargetLanguageChange: (lang: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  isTranslating: boolean;
}

export const TranslateModal: React.FC<TranslateModalProps> = ({
  open,
  targetLanguage,
  onTargetLanguageChange,
  onClose,
  onConfirm,
  isTranslating,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg">
        <h3 className="text-base font-semibold text-gray-800 mb-3">选择目标语言</h3>
        <select
          value={targetLanguage}
          onChange={(e) => onTargetLanguageChange(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="zh">中文</option>
          <option value="en">英文</option>
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            disabled={isTranslating}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={isTranslating}
          >
            开始翻译
          </button>
        </div>
      </div>
    </div>
  );
};
