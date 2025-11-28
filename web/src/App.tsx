import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { MobileLayout } from './components/MobileLayout';
import { ProjectListPage } from './pages/ProjectListPage';
import { MobileProjectListPage } from './pages/mobile/MobileProjectListPage';
import { UploadPage } from './pages/UploadPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { MobileProjectDetailPage } from './pages/mobile/MobileProjectDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { useIsMobile } from './hooks/useIsMobile';

const App = () => {
  // 生产环境使用 /miaoji 作为基础路径
  const basename = import.meta.env.PROD ? '/miaoji' : '/';
  const isMobile = useIsMobile();

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={isMobile ? <MobileLayout /> : <Layout />}>
          <Route index element={isMobile ? <MobileProjectListPage /> : <ProjectListPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="projects/:id" element={isMobile ? <MobileProjectDetailPage /> : <ProjectDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
