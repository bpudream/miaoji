import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Upload, Settings, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import { clsx } from 'clsx';

export const Layout = () => {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const isDetailPage = location.pathname.startsWith('/projects/');

  // Auto-collapse on project detail page
  useEffect(() => {
    setIsCollapsed(isDetailPage);
  }, [isDetailPage]);

  const isActive = (path: string) => {
    return location.pathname === path ? 'bg-blue-50 text-blue-600 border-r-4 border-blue-600' : 'text-gray-600 hover:bg-gray-50';
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className={clsx("bg-white shadow-md flex flex-col transition-all duration-300", isCollapsed ? "w-16" : "w-64")}>
        <div className="p-6 flex items-center justify-center">
          {isDetailPage && isCollapsed ? (
            <Link to="/" className="text-gray-500 hover:text-blue-600 transition-colors p-1" title="返回列表">
              <ArrowLeft className="w-6 h-6" />
            </Link>
          ) : (
            <h1 className={clsx("text-2xl font-bold text-blue-600 flex items-center gap-2 transition-all", isCollapsed && "justify-center")}>
              <span>🎙️</span> {!isCollapsed && '妙记 AI'}
            </h1>
          )}
        </div>
        <nav className="mt-6 flex-1">
          <Link
            to="/"
            className={clsx("flex items-center px-6 py-3 transition-colors", isActive('/'), isCollapsed && "justify-center px-3")}
            title="项目列表"
          >
            <LayoutDashboard className={clsx("w-5 h-5", !isCollapsed && "mr-3")} />
            {!isCollapsed && '项目列表'}
          </Link>
          <Link
            to="/upload"
            className={clsx("flex items-center px-6 py-3 transition-colors", isActive('/upload'), isCollapsed && "justify-center px-3")}
            title="新建上传"
          >
            <Upload className={clsx("w-5 h-5", !isCollapsed && "mr-3")} />
            {!isCollapsed && '新建上传'}
          </Link>
          <Link
            to="/settings"
            className={clsx("flex items-center px-6 py-3 transition-colors", isActive('/settings'), isCollapsed && "justify-center px-3")}
            title="系统设置"
          >
            <Settings className={clsx("w-5 h-5", !isCollapsed && "mr-3")} />
            {!isCollapsed && '系统设置'}
          </Link>
        </nav>
        <div className="border-t border-gray-100 p-2">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={clsx(
              "flex w-full items-center rounded-lg py-2 text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors",
              isCollapsed ? "justify-center" : "px-6"
            )}
            title={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            {!isCollapsed && <span className="ml-3 text-sm">收起侧边栏</span>}
          </button>
        </div>
        {!isCollapsed && (
          <div className="pb-6 px-6 text-xs text-gray-400">
            v1.0.0 (MVP)
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full p-4 sm:p-6 lg:p-8 mx-auto w-full max-w-[1920px] overflow-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

