import { useState } from 'react';
import { Server, HardDrive } from 'lucide-react';
import { SystemStatusTab } from '../components/SystemStatusTab';
import { StoragePathsTab } from '../components/StoragePathsTab';

type TabType = 'status' | 'storage';

export const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState<TabType>('status');

  const tabs = [
    { id: 'status' as TabType, label: '系统状态', icon: Server },
    { id: 'storage' as TabType, label: '存储路径', icon: HardDrive },
  ];

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-0 pb-20 md:pb-0">
      <div className="mb-6 md:mb-8">
        <h2 className="text-xl md:text-2xl font-bold text-gray-800">系统设置</h2>
        <p className="text-xs md:text-base text-gray-500 mt-1">管理系统连接与服务状态</p>
      </div>

      {/* Tab 导航 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div className="flex border-b border-gray-100">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 md:py-4 text-sm md:text-base font-medium transition-colors ${
                  isActive
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4 md:w-5 md:h-5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="min-h-[400px]">
        {activeTab === 'status' && <SystemStatusTab />}
        {activeTab === 'storage' && <StoragePathsTab />}
      </div>
    </div>
  );
};
