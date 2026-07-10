import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { AssetsList } from './pages/AssetsList';
import { AssetDetail } from './pages/AssetDetail';
import { StockByLocation } from './pages/StockByLocation';
import { StoresList } from './pages/StoresList';
import { StoreDetail } from './pages/StoreDetail';
import { StoreWizard } from './pages/StoreWizard';
import { GrvList } from './pages/GrvList';
import { IbtList } from './pages/IbtList';
import { PurchaseRequests } from './pages/PurchaseRequests';
import { Repairs } from './pages/Repairs';
import { Warranties } from './pages/Warranties';
import { Reports } from './pages/Reports';
import { Invoices } from './pages/Invoices';
import { AuditsList } from './pages/AuditsList';
import { AuditDetail } from './pages/AuditDetail';
import { ApiKeys } from './pages/ApiKeys';
import { Discovery } from './pages/Discovery';
import { Alerts } from './pages/Alerts';
import { Templates } from './pages/Templates';
import { Users } from './pages/Users';
import { TonerDashboard } from './pages/TonerDashboard';
import { TonerTypes } from './pages/TonerTypes';
import { TonerPlan } from './pages/TonerPlan';
import { TonerOrders } from './pages/TonerOrders';
import { TonerOrderDetail } from './pages/TonerOrderDetail';
import { Skus } from './pages/Skus';
import { Security } from './pages/Security';
import { AssetsImport } from './pages/AssetsImport';
import { ActivityLog } from './pages/ActivityLog';
import { Software } from './pages/Software';
import { Updates } from './pages/Updates';
import { StoreBackups } from './pages/StoreBackups';
import { useAuth } from './store/auth';

function Protected({ children }: { children: JSX.Element }) {
  const token = useAuth((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="assets" element={<AssetsList />} />
        <Route path="assets/:id" element={<AssetDetail />} />
        <Route path="stock" element={<StockByLocation />} />
        <Route path="stores" element={<StoresList />} />
        <Route path="stores/wizard" element={<StoreWizard />} />
        <Route path="stores/:id" element={<StoreDetail />} />
        <Route path="grv" element={<GrvList />} />
        <Route path="ibt" element={<IbtList />} />
        <Route path="procurement" element={<PurchaseRequests />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="repairs" element={<Repairs />} />
        <Route path="warranties" element={<Warranties />} />
        <Route path="audits" element={<AuditsList />} />
        <Route path="audits/:id" element={<AuditDetail />} />
        <Route path="reports" element={<Reports />} />
        <Route path="discovery" element={<Discovery />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="admin/templates" element={<Templates />} />
        <Route path="admin/users" element={<Users />} />
        <Route path="admin/api-keys" element={<ApiKeys />} />
        <Route path="toner" element={<TonerDashboard />} />
        <Route path="toner/types" element={<TonerTypes />} />
        <Route path="toner/plan" element={<TonerPlan />} />
        <Route path="toner/orders" element={<TonerOrders />} />
        <Route path="toner/orders/:id" element={<TonerOrderDetail />} />
        <Route path="admin/skus" element={<Skus />} />
        <Route path="admin/security" element={<Security />} />
        <Route path="admin/activity" element={<ActivityLog />} />
        <Route path="assets/import" element={<AssetsImport />} />
        <Route path="software" element={<Software />} />
        <Route path="admin/updates" element={<Updates />} />
        <Route path="stores/:id/backups" element={<StoreBackups />} />
      </Route>
    </Routes>
  );
}
