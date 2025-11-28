import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Upload, Settings } from 'lucide-react';
import { clsx } from 'clsx';

export const MobileLayout = () => {
  const location = useLocation();

  return (
    <div className="flex h-screen bg-gray-100 flex-col">
      {/* Top Navigation - Mobile Only */}
      <nav className="bg-white border-b border-gray-200 flex justify-around items-center h-16 shrink-0 px-2 z-50">
        <Link
          to="/"
          className={clsx(
            "flex flex-col items-center justify-center w-full h-full space-y-1 active:bg-gray-50",
            location.pathname === '/' ? "text-blue-600" : "text-gray-500"
          )}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[10px]">列表</span>
        </Link>
        <Link
          to="/upload"
          className={clsx(
            "flex flex-col items-center justify-center w-full h-full space-y-1 active:bg-gray-50",
            location.pathname === '/upload' ? "text-blue-600" : "text-gray-500"
          )}
        >
          <Upload className="w-5 h-5" />
          <span className="text-[10px]">上传</span>
        </Link>
        <Link
          to="/settings"
          className={clsx(
            "flex flex-col items-center justify-center w-full h-full space-y-1 active:bg-gray-50",
            location.pathname === '/settings' ? "text-blue-600" : "text-gray-500"
          )}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px]">设置</span>
        </Link>
      </nav>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative">
        <div className="h-full w-full overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

