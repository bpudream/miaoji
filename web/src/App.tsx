import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProjectListPage } from './pages/ProjectListPage';
import { UploadPage } from './pages/UploadPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { SettingsPage } from './pages/SettingsPage';

const App = () => {
  // 生产环境使用 /miaoji 作为基础路径
  const basename = import.meta.env.PROD ? '/miaoji' : '/';

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<ProjectListPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
