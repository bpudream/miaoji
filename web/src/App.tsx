import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProjectListPage } from './pages/ProjectListPage';
import { UploadPage } from './pages/UploadPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { SettingsPage } from './pages/SettingsPage';

const App = () => {
  return (
    <BrowserRouter>
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
