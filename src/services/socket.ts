
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const getSocket = () => socket;

export const emitLogin = (user: any) => {
    if (socket && socket.connected) {
        socket.emit('user_login', user);
    }
};

export const connectSocket = (url: string) => {
    if (socket) {
        socket.disconnect();
    }
    
    if (!url || url === 'standalone' || url.includes('undefined')) {
        console.log('[Socket] Standalone Mode: Sync disabled.');
        return null;
    }

    try {
        socket = io(url, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 2000
        });

        socket.on('connect', () => {
            console.log('[Socket] Network database link active.');
            const storedUser = localStorage.getItem('pharma_user_session');
            if (storedUser) {
                try {
                    socket?.emit('user_login', JSON.parse(storedUser));
                } catch(e) {}
            }
            window.dispatchEvent(new CustomEvent('local-data-update', { detail: { key: 'connection-ready' } }));
        });

        socket.on('data-change', async (data: { key: string }) => {
            console.log('[Socket] Remote update received:', data.key);
            const { db } = await import('./db');
            if (data.key === 'ALL') {
                await db.reconcileAll(true);
            } else if (data.key) {
                await db.get(data.key, true);
            }
            // Force a refresh of all components when any network change occurs
            window.dispatchEvent(new CustomEvent('local-data-update', { detail: { key: data.key } }));
            window.dispatchEvent(new CustomEvent('local-data-update', { detail: { key: 'all' } }));
        });

        socket.on('disconnect', () => {
            console.warn('[Socket] Lost connection to Main PC.');
            window.dispatchEvent(new CustomEvent('local-data-update', { detail: { key: 'connection-lost' } }));
        });

        return socket;
    } catch (e) {
        console.error('[Socket] Linkage failed:', e);
        return null;
    }
};

export const subscribeToChanges = (callback: (data: { key: string }) => void) => {
    if (!socket) return;
    socket.on('data-change', callback);
};

export const unsubscribeFromChanges = (callback: (data: { key: string }) => void) => {
    if (!socket) return;
    socket.off('data-change', callback);
};
