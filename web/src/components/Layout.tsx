import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Upload, Settings } from 'lucide-react';
import { clsx } from 'clsx';

export const Layout = () => {
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path ? 'bg-blue-50 text-blue-600 border-r-4 border-blue-600' : 'text-gray-600 hover:bg-gray-50';
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-64 bg-white shadow-md flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-blue-600 flex items-center gap-2">
            <span>🎙️</span> 妙记 AI
          </h1>
        </div>
        <nav className="mt-6 flex-1">
          <Link
            to="/"
            className={clsx("flex items-center px-6 py-3 transition-colors", isActive('/'))}
          >
            <LayoutDashboard className="w-5 h-5 mr-3" />
            项目列表
          </Link>
          <Link
            to="/upload"
            className={clsx("flex items-center px-6 py-3 transition-colors", isActive('/upload'))}
          >
            <Upload className="w-5 h-5 mr-3" />
            新建上传
          </Link>
          <Link
            to="/settings"
            className={clsx("flex items-center px-6 py-3 transition-colors", isActive('/settings'))}
          >
            <Settings className="w-5 h-5 mr-3" />
            系统设置
          </Link>
        </nav>
        <div className="p-6 text-xs text-gray-400">
          v1.0.0 (MVP)
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

