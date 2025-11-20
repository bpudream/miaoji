import React from 'react';

export const SettingsPage = () => {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6 text-gray-800">系统设置</h2>
      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-2xl">
            ⚙️
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-900">功能开发中</h3>
            <p className="text-gray-500">这里将包含上传限制、模型选择、界面主题等设置。</p>
          </div>
        </div>
        <div className="h-px bg-gray-100 my-6"></div>
        <div className="text-sm text-gray-400">
          Scheduled for Sprint 5
        </div>
      </div>
    </div>
  );
};

