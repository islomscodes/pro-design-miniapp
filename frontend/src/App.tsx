import React, { useState, useEffect } from 'react';
import { useInitData } from '@tma.js/sdk-react';
import Calculator from './components/Calculator';
import Loader from './components/Loader';

const App: React.FC = () => {
  const initData = useInitData();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeApp = async () => {
      if (!initData) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/user', {
          headers: {
            'x-telegram-init-data': initData.raw,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch user');
        }

        const userData = await response.json();
        setUser(userData);
      } catch (err) {
        console.error('Init error:', err);
        setError(err instanceof Error ? err.message : 'Initialization failed');
      } finally {
        setLoading(false);
      }
    };

    initializeApp();
  }, [initData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black flex items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-red-500 mb-4">Error</h1>
          <p className="text-gray-300">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-12 text-center">
          <h1 className="text-5xl font-bold mb-3 bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent">
            Pro Design
          </h1>
          <p className="text-gray-300 text-lg">Premium Blinds & Curtains Marketplace</p>
        </header>

        {user && <Calculator user={user} />}
      </div>
    </div>
  );
};

export default App;
