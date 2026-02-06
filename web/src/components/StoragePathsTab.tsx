import { StoragePathsManager } from './StoragePathsManager';
import { LocalModeSettingsCard } from './LocalModeSettingsCard';

export const StoragePathsTab = () => {
  return (
    <div className="space-y-6">
      <LocalModeSettingsCard />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden p-4 md:p-6">
        <StoragePathsManager />
      </div>
    </div>
  );
};

