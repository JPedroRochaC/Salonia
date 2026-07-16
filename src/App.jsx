import { Routes, Route } from 'react-router-dom';
import SalonHome from './pages/SalonHome';
import BookingWizard from './pages/BookingWizard';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route path="/:slug" element={<SalonHome />} />
      <Route path="/:slug/agendar" element={<BookingWizard />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
