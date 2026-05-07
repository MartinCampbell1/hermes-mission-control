import { Navigate, Outlet } from 'react-router';
import { useGetMeQuery } from './api';
import Layout from '../../widgets/layout';

export default function PrivateRoute() {
  const token = localStorage.getItem('token');

  const { isError } = useGetMeQuery(undefined, {
    skip: !token,
    refetchOnMountOrArgChange: true,
  });

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (isError) {
    localStorage.removeItem('token');
    return <Navigate to="/login" replace />;
  }

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
