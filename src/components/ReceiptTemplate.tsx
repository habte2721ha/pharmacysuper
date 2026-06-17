
import React from 'react';
import { Sale, PharmacyInfo } from '../types';

interface Props {
  sale: Sale;
  info: PharmacyInfo | null;
  isPrint?: boolean;
}

export const ReceiptTemplate: React.FC<Props> = ({ sale, info, isPrint = false }) => {
  const paperWidth = info?.hardware?.paperWidth === '58mm' ? 'w-[58mm]' : 'w-[80mm]';
  const fontSize = info?.hardware?.paperWidth === '58mm' ? 'text-[10px]' : 'text-xs';

  return (
    <div id={isPrint ? "receipt-print" : "receipt-content"} className={`bg-white p-6 ${paperWidth} relative overflow-hidden ${isPrint ? '' : 'shadow-none rounded-sm'}`}>
      <div className={`relative z-10 font-mono text-black ${fontSize}`}>
          <div className="text-center mb-4 border-b border-black pb-2">
            <div className="flex justify-center mb-2">
              <img src={info?.logo || "/pharmacy_logo.png"} alt="Logo" className="w-16 h-16 object-contain grayscale my-1 filter contrast-125" referrerPolicy="no-referrer" />
            </div>
            <h3 className="font-bold text-lg uppercase leading-tight">{info?.name || 'Pharmacy'}</h3>
            <p className="text-[10px]">{info?.address}</p>
            <p className="text-[10px]">Phone: {info?.phone}</p>
            {info?.tin && <p className="text-[10px]">TIN: {info.tin}</p>}
          </div>
          
          <div className="border-b border-black py-2 my-2 space-y-0.5">
            <div className="flex justify-between font-black">
              <span>Rcpt #:</span> 
              <span>{sale.receiptNumber}</span>
            </div>
            <div className="flex justify-between"><span>Date:</span> <span>{new Date(sale.date).toLocaleString()}</span></div>
            <div className="flex justify-between"><span>Customer:</span> <span className="truncate ml-2">{sale.customerName}</span></div>
            {sale.customerTin && <div className="flex justify-between"><span>Cust TIN:</span> <span>{sale.customerTin}</span></div>}
            <div className="flex justify-between"><span>Served By:</span> <span>{sale.soldBy}</span></div>
          </div>

          <div className="space-y-1 mb-4">
            <div className="flex font-bold border-b border-dashed border-black pb-1 mb-1 uppercase tracking-tighter">
              <span className="flex-1">Item</span>
              <span className="w-8 text-center">Qty</span>
              <span className="w-16 text-right">Amt</span>
            </div>
            {sale.items.map((item, i) => (
              <div key={`${item.id}-${i}`} className="flex justify-between leading-tight mb-1">
                <div className="flex-1 pr-1">
                  <div className="uppercase font-bold">{item.name}</div>
                  {item.discount && item.discount > 0 ? <div className="italic text-[8px]"> (Disc: {item.discount})</div> : null}
                </div>
                <span className="w-8 text-center">{item.cartQty}</span>
                <span className="w-16 text-right font-bold">{((item.sellingPrice * item.cartQty) - (item.discount || 0)).toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-black pt-2 space-y-1">
            <div className="flex justify-between"><span>Subtotal:</span><span>{sale.subTotal.toFixed(2)}</span></div>
            
            <div className="flex justify-between"><span>VAT ({sale.vatPercent}%):</span><span>{sale.vatAmount.toFixed(2)}</span></div>
            
            <div className="flex justify-between font-bold text-base border-t border-black mt-2 pt-1">
              <span>TOTAL:</span>
              <span>{sale.grandTotal.toFixed(2)}</span>
            </div>
            
            {/* Payment Details */}
            <div className="pt-2 mt-2 border-t border-dashed border-black">
              {sale.paymentMethods.map((pm, idx) => (
                <div key={idx} className="flex justify-between">
                    <span className="uppercase">{pm.method.replace('_', ' ')}</span>
                    <span className="font-bold">{pm.amount.toFixed(2)}</span>
                </div>
              ))}
              
              {/* Credit Details Info */}
              {sale.status === 'ON_CREDIT' && sale.creditDetails && (
                  <div className="mt-2 border border-black p-1 text-center font-bold text-[8px]">
                      <p>DUE DATE: {sale.creditDetails.dueDate}</p>
                      <p>PLEASE PAY BEFORE DUE DATE</p>
                  </div>
              )}

              {sale.status !== 'ON_CREDIT' && (
                  <div className="flex justify-between font-bold mt-1">
                    <span>Change:</span>
                    <span>{sale.changeGiven.toFixed(2)}</span>
                  </div>
              )}
            </div>
          </div>
          
          {/* Footer */}
          <div className="mt-6 pt-2 text-center text-[8px]">
              <p>Thank you for your patronage!</p>
              <p className="font-bold mt-1 opacity-50 uppercase tracking-widest text-[6px]">Software by APSMS</p>
          </div>
      </div>
    </div>
  );
};
