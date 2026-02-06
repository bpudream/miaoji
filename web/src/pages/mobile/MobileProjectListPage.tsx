import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../stores/useAppStore';
import { FileText, Clock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Project } from '../../lib/api';
import { getProjectStatusText } from '../../lib/status';

// 这是一个简化的移动端列表项组件，避免重复代码
const ProjectCard = ({ project }: { project: Project }) => {
    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
            case 'processing':
            case 'extracting':
            case 'transcribing':
            case 'ready_to_transcribe':
                return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
            case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
            default: return <Clock className="w-4 h-4 text-gray-400" />;
        }
    };

    return (
        <Link to={`/projects/${project.id}`} className="block bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-3 active:bg-gray-50">
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="p-2 bg-blue-50 rounded-lg text-blue-600 flex-shrink-0">
                        <FileText className="w-5 h-5" />
                    </div>
                    <h3 className="font-semibold text-gray-900 truncate flex-1 text-sm">{project.display_name || project.original_name}</h3>
                </div>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-500">
                <span className="flex items-center gap-1">
                    {getStatusIcon(project.status)}
                    <span className="font-medium">{getProjectStatusText(project.status, 'short')}</span>
                </span>
                <span>{new Date(project.created_at).toLocaleDateString()}</span>
            </div>
        </Link>
    );
};

export const MobileProjectListPage = () => {
    const { projects, loadProjects, isLoading } = useAppStore();

    useEffect(() => {
        loadProjects();
    }, [loadProjects]);

    return (
        <div className="p-4 pb-20"> {/* pb-20 for bottom safe area if needed, though layout handles it */}
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-800">所有项目</h2>
            </div>

            {isLoading && projects.length === 0 ? (
                <div className="text-center py-10">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-500 mb-2" />
                    <p className="text-sm text-gray-500">加载中...</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {projects.map(project => (
                        <ProjectCard key={project.id} project={project} />
                    ))}
                </div>
            )}

            {!isLoading && projects.length === 0 && (
                <div className="text-center py-10 bg-white rounded-xl border border-dashed border-gray-300">
                     <p className="text-gray-500 mb-2">还没有项目</p>
                     <Link to="/upload" className="text-blue-600 font-medium text-sm">去上传</Link>
                </div>
            )}
        </div>
    );
};

