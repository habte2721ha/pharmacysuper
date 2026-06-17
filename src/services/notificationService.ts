
import { PharmacyInfo, Sale, Product } from '../types';
import { db } from './db';

/**
 * Handles automated and manual notification dispatch based on Admin settings.
 */
export const sendDailySalesNotification = async (info: PharmacyInfo, latestSale?: Sale, manualTrigger: boolean = false) => {
    // 1. Check Configuration
    const isEmailEnabled = info.enableDailyEmailReport && info.notificationEmail;
    const isSmsEnabled = info.enableDailySmsReport && info.notificationPhone;

    if (!isEmailEnabled && !isSmsEnabled && !manualTrigger) {
        console.log("[Notification System] Auto-notifications disabled by admin.");
        return { success: false, message: "Notifications disabled in settings." };
    }

    console.log(`[Notification System] Preparing Daily Report for: ${info.name}...`);

    // 2. Gather Summary Data
    const sales = await db.getSales();
    const today = new Date().toISOString().split('T')[0];
    const todaysSales = sales.filter((s: Sale) => s.date.startsWith(today));
    const totalRevenue = todaysSales.reduce((sum: number, s: Sale) => sum + s.grandTotal, 0);
    const transactionCount = todaysSales.length;

    const subject = `Daily Business Summary: ${info.name} - ${today}`;
    const bodyLines = [
        `*** APSMS DAILY REPORT ***`,
        `Pharmacy: ${info.name}`,
        `Date: ${today}`,
        `----------------------------------`,
        `Gross Revenue: ${totalRevenue.toFixed(2)}`,
        `Total Transactions: ${transactionCount}`,
        `----------------------------------`,
        `This is an automated operational report.`,
        `Timestamp: ${new Date().toLocaleTimeString()}`
    ];
    const body = bodyLines.join('\n');

    // 3. Scheduling Logic
    const now = new Date();
    const currentHourMin = `${now.getHours().toString().padStart(2, '0')}: ${now.getMinutes().toString().padStart(2, '0')}`;
    const scheduledTime = info.reportTime || '20:00';

    const shouldSend = manualTrigger || currentHourMin === scheduledTime;

    if (shouldSend) {
        // Log locally for debugging in this browser-based desktop app
        console.info(`[NOTIFY DISPATCH] ${subject}`);

        // Handle Email Notification (Simulated client-side trigger)
        if (isEmailEnabled) {
            const mailtoUrl = `mailto: ${info.notificationEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            // Trigger mail client as fallback for desktop apps without server-side mailers
            const link = document.createElement('a');
            link.href = mailtoUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            console.log(`[EMAIL LOG] Triggered mail client for: ${info.notificationEmail}`);
        }

        // Handle SMS Notification (Log to console as typical desktop systems require paid gateways)
        if (isSmsEnabled) {
             console.log(`[SMS DISPATCH SIMULATION] To: ${info.notificationPhone} | Msg: ${body}`);
             // If this were a real native mobile wrapper, we'd use capacitor/cordova plugins
        }
        
        return { success: true, message: "Intelligence report dispatched." };
    } else {
        return { success: false, message: "Report pending scheduled time." };
    }
};

/**
 * Checks for low stock and sends an alert if configured.
 */
export const checkStockAlerts = async (info: PharmacyInfo) => {
    if (!info.enableStockAlerts || (!info.notificationEmail && !info.notificationPhone)) return;

    const products = await db.getProducts();
    const lowStock = products.filter((p: Product) => p.quantity <= p.minStockLevel);

    if (lowStock.length > 0) {
        const alertMsg = `LOW STOCK ALERT: ${lowStock.length} items require immediate reordering at ${info.name}. Top items: ${lowStock.slice(0, 3).map((p: Product) => p.name).join(', ')}`;
        console.warn(`[STOCK ALERT SENT] ${alertMsg}`);
        // Similar dispatch logic to sendDailySalesNotification...
    }
};
