
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../services/db';
import { Product, ProductCategory, BulkTransferRecord } from '../types';
import { useAppContext } from '../App';
import { 
  Search, ArrowRightLeft, Truck, Package, Trash2, FileText, Plus, CheckCircle, RefreshCw,
  History, Download, ChevronLeft, FileSpreadsheet, FileUp, Ban
} from 'lucide-react';
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";

interface TransferItem {
  product: Product;
  transferQty: number;
}

const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2);

export default function BulkTransfer() {
  const { user, pharmacyInfo, globalBranch } = useAppContext();
  const [products, setProducts] = useState<Product[]>([]);
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'NEW' | 'HISTORY'>('NEW');
  const [history, setHistory] = useState<BulkTransferRecord[]>([]);

  // Transfer Metadata
  const [meta, setMeta] = useState({
    transferType: 'INTERNAL',
    destination: '',
    driver: '',
    vehicleNo: '',
    date: new Date().toISOString().split('T')[0],
    notes: '',
    reason: ''
  });
  
  const [showMeta, setShowMeta] = useState(true);
  const [acceptBackupBranch, setAcceptBackupBranch] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    const [allProducts, allHistory] = await Promise.all([
      db.getProducts(),
      db.getBulkTransfers()
    ]);
    const productsArr = Array.isArray(allProducts) ? allProducts : [];
    const historyArr = Array.isArray(allHistory) ? allHistory : [];
    
    const filterBranch = (p: any) => {
        if (user?.role === 'ADMIN') {
             if (globalBranch) {
                 if (globalBranch === 'MAIN') return !p.branch;
                 return p.branch === globalBranch || p.originBranch === globalBranch;
             }
             return true;
        }
        return !p.branch || p.branch === user?.branch || p.originBranch === user?.branch;
    };

    setProducts(productsArr.filter((p: any) => p.quantity > 0 && filterBranch(p)));
    setHistory([...historyArr].filter((h: any) => filterBranch(h)).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()));
  }, [user, globalBranch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const downloadJSON = (batchId: string, metadata: any, items: any[], isHistory: boolean = false) => {
      const data = {
          batchId,
          metadata,
          data: items.map(item => isHistory ? item : { 
             productName: item.product.name,
             productCategory: item.product.type === ProductCategory.COSMETIC ? 'Cosmetic' : item.product.medCategory,
             supplier: item.product.supplier,
             batchNumber: item.product.batchNumber,
             expiryDate: item.product.expiryDate,
             unit: item.product.unit,
             buyingPrice: item.product.buyingPrice,
             sellingPrice: item.product.sellingPrice,
             transferQty: item.transferQty
          })
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Transfer_Data_${metadata.destination.replace(/\s/g, '_')}_${metadata.date}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadExcel = (data: any[][], filename: string) => {
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Manifest");
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const generateManifestExcel = (batchId: string, metadata: any, items: any[], isHistory: boolean = false) => {
      let totalValue = 0;
      let totalQty = 0;

      const rows = [
          ["STOCK TRANSFER REAL-TIME MANIFEST", isHistory ? "(COPY)" : ""],
          [],
          ["Source Branch", pharmacyInfo?.name || "Main Pharmacy"],
          ["Destination Branch", metadata.destination],
          ["Date Generated", metadata.date],
          ["Reference ID", `TRF-${batchId}`],
          ["Driver/Carrier Name", metadata.driver || 'N/A'],
          ["Vehicle Number", metadata.vehicleNo || 'N/A'],
          ["Transfer Reason", metadata.reason || '-'],
          [],
          ["No", "Product Name", "Product Category", "Supplier/Vendor", "Batch #", "Expiry Date", "Quantity Transferred", "Unit Type", "Unit Buying Price", "Unit Selling Price", "Subtotal Value (Selling)"],
      ];

      items.forEach((item: any, index) => {
          let prodName, prodCat, prodSupp, batchNo, expDate, transferQty, buyP = 0, sellP = 0, unitStr = '';
          if (isHistory) {
              const hItem = item;
              prodName = hItem.productName;
              prodCat = hItem.productCategory;
              prodSupp = hItem.supplier;
              batchNo = hItem.batchNumber;
              expDate = hItem.expiryDate;
              transferQty = hItem.transferQty;
              buyP = hItem.buyingPrice;
              sellP = hItem.sellingPrice;
              unitStr = hItem.unit;
          } else {
              const pItem = item.product;
              prodName = pItem.name;
              prodCat = pItem.type === ProductCategory.COSMETIC ? 'Cosmetic' : pItem.medCategory;
              prodSupp = pItem.supplier;
              batchNo = pItem.batchNumber;
              expDate = pItem.expiryDate;
              transferQty = item.transferQty;
              buyP = pItem.buyingPrice;
              sellP = pItem.sellingPrice;
              unitStr = pItem.unit;
          }

          const value = sellP * transferQty;
          totalValue += value;
          totalQty += transferQty;

          rows.push([
              index + 1,
              prodName || '',
              prodCat || '',
              prodSupp || '',
              batchNo || '',
              expDate || '',
              transferQty,
              unitStr || '',
              buyP,
              sellP,
              value
          ]);
      });

      rows.push([]);
      rows.push(["Summary Summary Metrics"]);
      rows.push(["Distinct Item Types Included", items.length]);
      rows.push(["Total Stock Units Transferred", totalQty]);
      rows.push(["Total Transfer Value (USD)", `${totalValue.toFixed(2)}`]);

      downloadExcel(rows, `Transfer_Manifest_${metadata.destination.replace(/\s/g, '_')}_${metadata.date}.xlsx`);
  };

  // --- Logic ---

  const addToTransfer = (product: Product) => {
    const exists = transferItems.find((t: any) => t.product.id === product.id);
    if (exists) {
        // If already in list, increment if stock allows
        if (exists.transferQty < product.quantity) {
            updateQty(product.id, exists.transferQty + 1);
        }
    } else {
        setTransferItems([...transferItems, { product, transferQty: 1 }]);
    }
  };

  const updateQty = (productId: string, newQty: number) => {
    setTransferItems(prev => prev.map((item: any) => {
        if (item.product.id === productId) {
            // Validation: Cannot transfer more than available
            const validQty = Math.max(1, Math.min(newQty, item.product.quantity));
            return { ...item, transferQty: validQty };
        }
        return item;
    }));
  };

  const removeItem = (productId: string) => {
    setTransferItems(prev => prev.filter((t: any) => t.product.id !== productId));
  };

  const generateManifestPDF = (batchId: string, metadata: any, items: any[], isHistory: boolean = false) => {
      const doc = new jsPDF('landscape');
      
      // Header
      doc.setFontSize(22);
      doc.setTextColor(0, 128, 128); // Teal
      doc.text("STOCK TRANSFER MANIFEST", 148.5, 20, { align: 'center' });
      
      if (isHistory) {
          doc.setFontSize(10);
          doc.setTextColor(150, 150, 150);
          doc.text("(COPY)", 148.5, 25, { align: 'center' });
      }
      
      // Meta Info
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      
      doc.setFont("helvetica", "bold");
      doc.text("Source:", 14, 35);
      doc.setFont("helvetica", "normal");
      doc.text(pharmacyInfo?.name || "Main Pharmacy", 40, 35);
      
      doc.setFont("helvetica", "bold");
      doc.text("Destination:", 110, 35);
      doc.setFont("helvetica", "normal");
      doc.text(metadata.destination, 140, 35);

      doc.setFont("helvetica", "bold");
      doc.text("Date:", 210, 35);
      doc.setFont("helvetica", "normal");
      doc.text(metadata.date, 230, 35);

      doc.setFont("helvetica", "bold");
      doc.text("Reference #:", 14, 43);
      doc.setFont("helvetica", "normal");
      doc.text(batchId, 40, 43);

      doc.setFont("helvetica", "bold");
      doc.text("Driver/Carrier:", 110, 43);
      doc.setFont("helvetica", "normal");
      doc.text(`${metadata.driver || 'N/A'} (${metadata.vehicleNo || 'N/A'})`, 140, 43);

      doc.setFont("helvetica", "bold");
      doc.text("Reason:", 210, 43);
      doc.setFont("helvetica", "normal");
      doc.text(metadata.reason || '-', 230, 43);

      // Table Header
      let y = 55;
      doc.setFillColor(240, 240, 240);
      doc.rect(14, y, 269, 10, 'F');
      doc.setFont("helvetica", "bold");
      doc.text("Item Details", 16, y + 6);
      doc.text("Category", 75, y + 6);
      doc.text("Supplier", 105, y + 6);
      doc.text("Batch", 145, y + 6);
      doc.text("Expiry", 170, y + 6);
      doc.text("Qty(Unit)", 195, y + 6);
      doc.text("Pricing(Buy/Sell)", 230, y + 6);
      doc.text("Total", 270, y + 6);
      
      y += 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      let totalValue = 0;
      let totalQty = 0;

      items.forEach((item: any, index) => {
          if (y > 180) { doc.addPage(); y = 20; }
          
          let prodName, prodCat, prodSupp, batchNo, expDate, transferQty, buyP = 0, sellP = 0, unitStr = '';
          if (isHistory) {
              const hItem = item;
              prodName = hItem.productName;
              prodCat = hItem.productCategory;
              prodSupp = hItem.supplier;
              batchNo = hItem.batchNumber;
              expDate = hItem.expiryDate;
              transferQty = hItem.transferQty;
              buyP = hItem.buyingPrice;
              sellP = hItem.sellingPrice;
              unitStr = hItem.unit;
          } else {
              const pItem = item.product;
              prodName = pItem.name;
              prodCat = pItem.type === ProductCategory.COSMETIC ? 'Cosmetic' : pItem.medCategory;
              prodSupp = pItem.supplier;
              batchNo = pItem.batchNumber;
              expDate = pItem.expiryDate;
              transferQty = item.transferQty;
              buyP = pItem.buyingPrice;
              sellP = pItem.sellingPrice;
              unitStr = pItem.unit;
          }

          const value = sellP * transferQty;
          totalValue += value;
          totalQty += transferQty;

          doc.text(`${index + 1}. ${prodName?.substring(0,30) || '-'}`, 16, y);
          doc.text(prodCat?.substring(0,18) || '-', 75, y);
          doc.text(prodSupp?.substring(0,20) || '-', 105, y);
          doc.text(batchNo || '-', 145, y);
          doc.text(expDate || '-', 170, y);
          doc.text(`${transferQty} ${unitStr || ''}`, 195, y);
          doc.text(`${buyP?.toFixed(2) || '0.00'} / ${sellP?.toFixed(2) || '0.00'}`, 230, y);
          doc.text(`${value.toFixed(2)}`, 270, y);
          
          y += 10;
          doc.setDrawColor(230, 230, 230);
          doc.line(14, y - 3, 283, y - 3);
      });

      // Footer Totals
      y += 5;
      doc.setFont("helvetica", "bold");
      doc.text(`Total Items: ${items.length}`, 14, y);
      doc.text(`Total Units: ${totalQty}`, 150, y);
      doc.text(`Total Transfer Value: ${totalValue.toFixed(2)}`, 230, y);

      // Signatures
      y += 25;
      doc.setLineWidth(0.5);
      doc.setDrawColor(0, 0, 0);
      
      doc.line(14, y, 80, y);
      doc.text("Released By (Sign & Date)", 14, y + 5);
      
      doc.line(210, y, 280, y);
      doc.text("Received By (Sign & Date)", 210, y + 5);

      doc.save(`Transfer_Manifest_${metadata.destination.replace(/\s/g, '_')}_${metadata.date}.pdf`);
  };

  const handleExecuteTransfer = async () => {
      if (!user) return;
      if (!meta.destination) { alert("Please enter a destination branch/pharmacy."); return; }
      if (transferItems.length === 0) { alert("Transfer list is empty."); return; }

      const isInternalBranch = meta.transferType === 'INTERNAL';
      const destBranchVal = meta.destination === 'GLOBAL_MAIN' ? '' : meta.destination;
      const displayDest = isInternalBranch && meta.destination === 'GLOBAL_MAIN' ? 'Main Branch' : meta.destination;

      if (!window.confirm(`Confirm transfer of ${transferItems.length} line items to ${displayDest}?`)) return;

      setIsSubmitting(true);
      const batchId = generateId().slice(0, 8).toUpperCase();

      try {
          const simplifiedItemsForDb = transferItems.map((item: any) => ({
             productName: item.product.name,
             productCategory: item.product.type === ProductCategory.COSMETIC ? 'Cosmetic' : item.product.medCategory,
             supplier: item.product.supplier,
             batchNumber: item.product.batchNumber,
             expiryDate: item.product.expiryDate,
             unit: item.product.unit,
             buyingPrice: item.product.buyingPrice,
             sellingPrice: item.product.sellingPrice,
             transferQty: item.transferQty
          }));

          const transferRecord: BulkTransferRecord = {
              id: generateId(),
              batchId,
              date: meta.date + "T" + new Date().toISOString().split('T')[1],
              destination: displayDest,
              driver: meta.driver,
              vehicleNo: meta.vehicleNo,
              reason: meta.reason,
              items: simplifiedItemsForDb,
              totalValue: transferItems.reduce((sum, item) => sum + (item.product.sellingPrice * item.transferQty), 0),
              totalQty: transferItems.reduce((sum, item) => sum + item.transferQty, 0),
              userName: user.username,
              status: 'ACTIVE'
          };

          const allProductsCache: Product[] = await db.getProducts() || [];
          const updatedProducts: Product[] = [];
          const newProducts: Product[] = [];
          
          for (const item of transferItems) {
              // 1. Update Product Stock (Source)
              const updatedProduct = { 
                  ...item.product, 
                  quantity: item.product.quantity - item.transferQty 
              };
              updatedProducts.push(updatedProduct);

              // 2. Add Bin Card Entry (Source)
              await db.addBinCardEntry(item.product.id, {
                  id: generateId(),
                  date: new Date().toISOString(),
                  type: 'TRANSFER_OUT',
                  reference: `TRF-${batchId} to ${displayDest}`,
                  batchNumber: item.product.batchNumber,
                  expiryDate: item.product.expiryDate,
                  inQty: 0,
                  outQty: item.transferQty,
                  balance: updatedProduct.quantity,
                  user: user.username
              });

              if (isInternalBranch) {
                  const existingDestProduct = allProductsCache.find((p: Product) => 
                      (p.branch || '') === destBranchVal &&
                      p.name.toLowerCase() === item.product.name.toLowerCase() &&
                      p.batchNumber === item.product.batchNumber &&
                      !p.isDeleted
                  );

                  let destProductId = '';
                  let newBalance = 0;

                  if (existingDestProduct) {
                      const destProduct = { ...existingDestProduct, quantity: existingDestProduct.quantity + item.transferQty };
                      destProductId = destProduct.id;
                      newBalance = destProduct.quantity;
                      updatedProducts.push(destProduct);
                      existingDestProduct.quantity = destProduct.quantity; // Update cache
                  } else {
                      const destProduct = { 
                          ...item.product, 
                          id: generateId(), 
                          branch: destBranchVal || undefined, 
                          quantity: item.transferQty 
                      };
                      destProductId = destProduct.id;
                      newBalance = destProduct.quantity;
                      newProducts.push(destProduct);
                      allProductsCache.push(destProduct); // Update cache
                  }
                  
                  await db.addBinCardEntry(destProductId, {
                      id: generateId(),
                      date: new Date().toISOString(),
                      type: 'RECEIVED',
                      reference: `Received TRF-${batchId} from ${item.product.branch || 'Main Branch'}`,
                      batchNumber: item.product.batchNumber || '',
                      expiryDate: item.product.expiryDate || '',
                      inQty: item.transferQty,
                      outQty: 0,
                      balance: newBalance,
                      user: user.username
                  });
              }
          }

          // Apply DB Updates in a single batch
          await db.updateProductsBatch(updatedProducts, newProducts);

          // 3. Log Activity
          await db.addBulkTransfer(transferRecord);
          await db.logActivity(user, 'BULK_TRANSFER', `Executed Transfer #${batchId} to ${displayDest}`);

          // 4. Generate Documentation (PDF, Excel, JSON)
          const localMeta = { ...meta, destination: displayDest };
          generateManifestPDF(batchId, localMeta, transferItems, false);
          generateManifestExcel(batchId, localMeta, transferItems, false);
          downloadJSON(batchId, localMeta, transferItems, false);

          // 5. Reset
          setTransferItems([]);
          setMeta({ ...meta, notes: '', driver: '', vehicleNo: '', reason: '' });
          alert("Transfer executed successfully. Manifest downloaded.");
          loadData(); // Refresh stock levels

      } catch (e) {
          console.error(e);
          alert("Error executing transfer. Please check console.");
      } finally {
          setIsSubmitting(false);
      }
  };

  const handleVoidTransfer = async (record: BulkTransferRecord) => {
      if (!user) return;
      if (record.status === 'VOIDED') {
          alert("This transfer is already voided.");
          return;
      }

      if (!window.confirm(`Are you sure you want to void transfer TRF-${record.batchId}? This will reverse inventory changes in both source and destination branches.`)) return;
      
      const voidReason = prompt("Reason for voiding this transfer:");
      if (voidReason === null) return;

      setIsSubmitting(true);
      try {
          const allProductsCache: Product[] = await db.getProducts() || [];
          const updatedProducts: Product[] = [];
          
          const isInternalBranch = ['GLOBAL_MAIN', ...pharmacyInfo.branches || []].includes(record.destination === 'Main Branch' ? 'GLOBAL_MAIN' : record.destination);
          const sourceBranchVal = globalBranch === 'ALL' ? '' : globalBranch;
          const destBranchVal = record.destination === 'Main Branch' ? '' : record.destination;

          for (const item of record.items) {
              const sourceProduct = allProductsCache.find(p => 
                  (p.branch || '') === sourceBranchVal &&
                  p.name.toLowerCase() === item.productName.toLowerCase() &&
                  p.batchNumber === item.batchNumber &&
                  !p.isDeleted
              );

              if (sourceProduct) {
                  const returnedProduct = { ...sourceProduct, quantity: sourceProduct.quantity + item.transferQty };
                  updatedProducts.push(returnedProduct);
                  sourceProduct.quantity = returnedProduct.quantity;

                  await db.addBinCardEntry(sourceProduct.id, {
                      id: generateId(),
                      date: new Date().toISOString(),
                      type: 'RECEIVED',
                      reference: `Reversal of TRF-${record.batchId}`,
                      batchNumber: item.batchNumber || '',
                      expiryDate: item.expiryDate || '',
                      inQty: item.transferQty,
                      outQty: 0,
                      balance: returnedProduct.quantity,
                      user: user.username
                  });
              }

              if (isInternalBranch) {
                  const destProduct = allProductsCache.find(p => 
                      (p.branch || '') === destBranchVal &&
                      p.name.toLowerCase() === item.productName.toLowerCase() &&
                      p.batchNumber === item.batchNumber &&
                      !p.isDeleted
                  );

                  if (destProduct) {
                      const returnedDest = { ...destProduct, quantity: destProduct.quantity - item.transferQty };
                      updatedProducts.push(returnedDest);
                      destProduct.quantity = returnedDest.quantity;

                      await db.addBinCardEntry(destProduct.id, {
                          id: generateId(),
                          date: new Date().toISOString(),
                          type: 'TRANSFER_OUT',
                          reference: `Reversal of TRF-${record.batchId} (Void)`,
                          batchNumber: item.batchNumber || '',
                          expiryDate: item.expiryDate || '',
                          inQty: 0,
                          outQty: item.transferQty,
                          balance: returnedDest.quantity,
                          user: user.username
                      });
                  }
              }
          }

          if (updatedProducts.length > 0) {
              await db.updateProductsBatch(updatedProducts, []);
          }

          const updatedRecord: BulkTransferRecord = { 
              ...record, 
              status: 'VOIDED',
              voidReason: voidReason,
              voidDate: new Date().toISOString()
          };

          await db.addBulkTransfer(updatedRecord);
          await db.logActivity(user, 'BULK_TRANSFER', `Voided Transfer #${record.batchId}. Reason: ${voidReason}`);

          alert("Transfer voided and inventory reversed successfully.");
          loadData();
      } catch (e) {
          console.error(e);
          alert("Error voiding transfer. Please check console.");
      } finally {
          setIsSubmitting(false);
      }
  };

  const handleCompleteTransfer = async (record: BulkTransferRecord) => {
      if (!user) return;
      if (record.status !== 'ACTIVE' && record.status !== undefined) {
          alert("Only active transfers can be marked as completed.");
          return;
      }
      
      const confirmCompletion = window.confirm(`Mark transfer TRF-${record.batchId} as fully completed and received?`);
      if (!confirmCompletion) return;

      setIsSubmitting(true);
      try {
          const updatedRecord: BulkTransferRecord = { 
              ...record, 
              status: 'COMPLETED'
          };

          await db.addBulkTransfer(updatedRecord);
          await db.logActivity(user, 'BULK_TRANSFER', `Marked Transfer #${record.batchId} as COMPLETED`);

          alert(`Transfer TRF-${record.batchId} marked as completed successfully.`);
          loadData();
      } catch (e) {
          console.error(e);
          alert("Error updating transfer status. Please check console.");
      } finally {
          setIsSubmitting(false);
      }
  };

  const filteredSourceProducts = useMemo(() => {
      return products.filter((p: any) => 
          p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
          p.batchNumber?.toLowerCase().includes(searchTerm.toLowerCase())
      );
  }, [products, searchTerm]);

  const totalTransferValue = transferItems.reduce((sum, item) => sum + (item.product.sellingPrice * item.transferQty), 0);

  const generateFullHistoryPDF = () => {
      const doc = new jsPDF('landscape');
      
      // Header
      doc.setFontSize(22);
      doc.setTextColor(0, 128, 128); // Teal
      doc.text("FULL TRANSFER HISTORY REPORT", 148.5, 20, { align: 'center' });
      
      doc.setFontSize(10);
      doc.setTextColor(150, 150, 150);
      doc.text(`Generated on: ${new Date().toLocaleString()}`, 148.5, 26, { align: 'center' });

      let y = 35;

      // Table Header
      doc.setFillColor(240, 240, 240);
      doc.rect(14, y, 269, 10, 'F');
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0, 0, 0);
      doc.text("Date", 16, y + 6);
      doc.text("Reference #", 45, y + 6);
      doc.text("Destination", 75, y + 6);
      doc.text("Driver / Vehicle", 125, y + 6);
      doc.text("Items", 185, y + 6);
      doc.text("Total Value", 215, y + 6);
      doc.text("Operated By", 245, y + 6);
      
      y += 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      let grandTotalValue = 0;
      let grandTotalUnits = 0;

      history.forEach((record, index) => {
          if (y > 180) { doc.addPage(); y = 20; }
          const localDate = new Date(record.date).toLocaleDateString();
          const driverText = `${record.driver || 'N/A'} (${record.vehicleNo || 'N/A'})`.substring(0, 30);
          
          doc.text(localDate, 16, y);
          doc.text(record.batchId, 45, y);
          doc.text(record.destination?.substring(0, 25) || '-', 75, y);
          doc.text(driverText, 125, y);
          doc.text(`${record.items.length} items (${record.totalQty} units)`, 185, y);
          doc.text(record.totalValue.toFixed(2), 215, y);
          doc.text(record.userName?.substring(0, 15) || '-', 245, y);

          grandTotalValue += record.totalValue;
          grandTotalUnits += record.totalQty;
          
          y += 8;
      });

      y += 5;
      if (y > 180) { doc.addPage(); y = 20; }
      doc.setLineDashPattern([2, 2], 0);
      doc.line(14, y, 283, y);
      doc.setLineDashPattern([], 0);
      
      y += 6;
      doc.setFont("helvetica", "bold");
      doc.text("GRAND TOTAL:", 145, y);
      doc.text(`${grandTotalUnits} units`, 185, y);
      doc.text(grandTotalValue.toFixed(2), 215, y);

      doc.save(`Full_Transfer_History_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col gap-3">
        <div className="flex justify-between items-center">
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <ArrowRightLeft className="text-indigo-600" size={20} /> Stock Transfer
            </h1>
            <div className="flex bg-gray-100 rounded-lg p-1 items-center gap-1">
                {pharmacyInfo?.branches && pharmacyInfo.branches.length > 0 && (
                    <select 
                        value={acceptBackupBranch}
                        onChange={(e) => setAcceptBackupBranch(e.target.value)}
                        className="p-2 text-sm bg-white border border-gray-200 rounded min-w-[150px] mr-2"
                    >
                        <option value="">Main Branch</option>
                        {pharmacyInfo.branches.map(b => (
                            <option key={b} value={b}>{b}</option>
                        ))}
                    </select>
                )}
                <input 
                    type="file" 
                    id="accept-backup" 
                    className="hidden" 
                    onClick={(e) => (e.target as HTMLInputElement).value = ''}
                    accept=".json,.xls,.xlsx,.csv" 
                    onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (!window.confirm("This will process the selected backup/transfer data file and merge into your inventory. Proceed?")) return;
                        try {
                            setIsSubmitting(true);
                            // Support JSON
                            if (file.name.toLowerCase().endsWith('.json')) {
                                const reader = new FileReader();
                                reader.onload = async (event) => {
                                    try {
                                        const json = JSON.parse(event.target?.result as string);
                                        const dataToImport = json.data || json;
                                        await db.importBackup(dataToImport, { itemsOnly: true, branch: acceptBackupBranch || undefined });
                                        alert("Backup data accepted successfully!");
                                        loadData();
                                    } catch (err: any) { alert("Format Error: " + err.message); }
                                    finally { setIsSubmitting(false); }
                                };
                                reader.readAsText(file);
                            } else {
                                alert("Please import the JSON manifest file from the source transfer. Excel import must be done via Admin > Restore.");
                                setIsSubmitting(false);
                            }
                        } catch (e) {
                            setIsSubmitting(false);
                        }
                    }} 
                />
                <label htmlFor="accept-backup" className="px-4 py-2 cursor-pointer rounded-md font-bold text-sm transition-all focus:outline-none flex items-center gap-2 bg-indigo-50 border border-indigo-100 text-indigo-700 hover:bg-indigo-100 shadow-sm mr-2">
                    <FileUp size={16}/> Accept Backup Data
                </label>

                <button
                    onClick={() => setViewMode('NEW')}
                    className={`px-4 py-2 rounded-md font-bold text-sm transition-all focus:outline-none ${viewMode === 'NEW' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    New Transfer
                </button>
                <button
                    onClick={() => setViewMode('HISTORY')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold text-sm transition-all focus:outline-none ${viewMode === 'HISTORY' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <History size={16}/> History
                </button>
            </div>
        </div>

        {viewMode === 'NEW' ? (
        <div className="flex-1 flex gap-4 overflow-hidden">
            
            {/* LEFT PANEL: Source Inventory */}
            <div className="w-1/2 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col">
                <div className="p-3 border-b bg-gray-50 flex justify-between items-center gap-3">
                    <h2 className="font-bold text-gray-700 flex items-center gap-2 whitespace-nowrap">
                        <Package size={16}/> Source
                    </h2>
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-2 text-gray-400" size={14}/>
                        <input 
                            className="w-full pl-8 pr-3 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-indigo-500"
                            placeholder="Search item or batch..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-1">
                    {filteredSourceProducts.map(product => (
                        <div key={product.id} className="flex justify-between items-center p-2 hover:bg-gray-50 border-b last:border-0 group">
                            <div>
                                <div className="font-bold text-gray-800 text-sm leading-tight">{product.name}</div>
                                <div className="text-[9px] text-gray-500 flex flex-wrap gap-1 mt-1">
                                    <span className="bg-gray-100 px-1 rounded border border-gray-200">Qty: {product.quantity} {product.unit || ''}</span>
                                    <span className="bg-gray-100 px-1 rounded border border-gray-200">Batch: {product.batchNumber || 'N/A'}</span>
                                    <span className="bg-blue-50 px-1 rounded border border-blue-100 text-blue-600">Cat: {product.type === ProductCategory.COSMETIC ? 'Cosmetic' : product.medCategory || 'N/A'}</span>
                                    <span className="bg-purple-50 px-1 rounded border border-purple-100 text-purple-600">Buy: {product.buyingPrice?.toFixed(2) || '0.00'} / Sell: {product.sellingPrice?.toFixed(2) || '0.00'}</span>
                                </div>
                            </div>
                            <button 
                                onClick={() => addToTransfer(product)}
                                className="bg-white border border-indigo-200 text-indigo-600 p-1.5 rounded hover:bg-indigo-50 shrink-0 ml-2"
                            >
                                <Plus size={16}/>
                            </button>
                        </div>
                    ))}
                    {filteredSourceProducts.length === 0 && (
                        <div className="p-8 text-center text-gray-400 text-sm">No items found.</div>
                    )}
                </div>
            </div>

            {/* RIGHT PANEL: Transfer Manifest */}
            <div className="w-1/2 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col">
                <div className="p-3 border-b bg-indigo-50">
                    <div className="flex justify-between items-center">
                        <h2 className="font-bold text-indigo-900 flex items-center gap-2">
                            <FileText size={18}/> Transfer Manifest
                        </h2>
                        <button 
                            onClick={() => setShowMeta(!showMeta)} 
                            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-100 px-2 py-1 rounded"
                        >
                            {showMeta ? 'Hide Details ▲' : 'Show Details ▼'}
                        </button>
                    </div>
                    
                    {/* Header Form */}
                    {showMeta && (
                    <div className="grid grid-cols-2 gap-3 mt-3">
                        <div>
                            <label className="block text-[10px] font-bold text-indigo-800 mb-0.5">Transfer Type</label>
                            <select 
                                className="w-full border border-indigo-200 rounded p-1 text-xs bg-white"
                                value={meta.transferType}
                                onChange={e => setMeta({...meta, transferType: e.target.value as any, destination: ''})}
                            >
                                <option value="INTERNAL">Internal Branch Transfer</option>
                                <option value="EXTERNAL">External / Vendor Transfer</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-indigo-800 mb-0.5">Destination Branch</label>
                            {meta.transferType === 'INTERNAL' ? (
                                <select 
                                    className="w-full border border-indigo-200 rounded p-1 text-xs bg-white"
                                    value={meta.destination}
                                    onChange={e => setMeta({...meta, destination: e.target.value})}
                                >
                                    <option value="">Select Target Branch...</option>
                                    <option value="GLOBAL_MAIN">Main Branch</option>
                                    {pharmacyInfo?.branches?.map(b => (
                                        <option key={b} value={b}>{b}</option>
                                    ))}
                                </select>
                            ) : (
                                <input 
                                    className="w-full border border-indigo-200 rounded p-1 text-xs"
                                    placeholder="Enter external destination..."
                                    value={meta.destination}
                                    onChange={e => setMeta({...meta, destination: e.target.value})}
                                />
                            )}
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-indigo-800 mb-0.5">Transfer Date</label>
                            <input 
                                type="date"
                                className="w-full border border-indigo-200 rounded p-1 text-xs"
                                value={meta.date}
                                onChange={e => setMeta({...meta, date: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-indigo-800 mb-0.5">Driver / Vehicle No.</label>
                            <div className="flex gap-1">
                              <input 
                                  className="w-1/2 border border-indigo-200 rounded p-1 text-xs"
                                  placeholder="Driver"
                                  value={meta.driver}
                                  onChange={e => setMeta({...meta, driver: e.target.value})}
                              />
                              <input 
                                  className="w-1/2 border border-indigo-200 rounded p-1 text-xs"
                                  placeholder="Plate No."
                                  value={meta.vehicleNo}
                                  onChange={e => setMeta({...meta, vehicleNo: e.target.value})}
                              />
                            </div>
                        </div>
                        <div className="col-span-2">
                            <label className="block text-[10px] font-bold text-indigo-800 mb-0.5">Transfer Reason</label>
                            <input 
                                className="w-full border border-indigo-200 rounded p-1 text-xs"
                                placeholder="e.g. Stock Rebalancing"
                                value={meta.reason}
                                onChange={e => setMeta({...meta, reason: e.target.value})}
                            />
                        </div>
                    </div>
                    )}
                </div>

                {/* Selected Items List */}
                <div className="flex-1 overflow-x-auto overflow-y-auto p-0 border-t border-gray-200">
                    <table className="w-full text-[10px] sm:text-xs text-left min-w-[400px]">
                        <thead className="bg-gray-100 text-gray-600 sticky top-0 shadow-sm">
                            <tr>
                                <th className="p-2">Item Details</th>
                                <th className="p-2">Information</th>
                                <th className="p-2 text-center">Avail</th>
                                <th className="p-2 text-center w-20">Trf Qty</th>
                                <th className="p-2 w-8"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {transferItems.map((item: any) => (
                                <tr key={item.product.id} className="hover:bg-indigo-50/30">
                                    <td className="p-2">
                                        <div className="font-bold text-gray-800">{item.product.name}</div>
                                        <div className="text-[9px] text-gray-500 mt-0.5">
                                            B: {item.product.batchNumber || 'N/A'} | {item.product.unit || 'N/A'}
                                        </div>
                                    </td>
                                    <td className="p-2">
                                        <div className="text-[9px] text-gray-600">Supp: {item.product.supplier || 'N/A'}</div>
                                        <div className="text-[9px] text-gray-500 mt-0.5">
                                            Buy: {item.product.buyingPrice?.toFixed(2) || '0.00'} / Sell: {item.product.sellingPrice?.toFixed(2) || '0.00'}
                                        </div>
                                    </td>
                                    <td className="p-2 text-center text-gray-500 font-bold">{item.product.quantity}</td>
                                    <td className="p-2 text-center">
                                        <input 
                                            type="number"
                                            className="w-16 text-center border border-gray-300 rounded p-1 font-bold outline-none focus:border-indigo-500 text-xs"
                                            value={item.transferQty}
                                            onChange={e => updateQty(item.product.id, parseInt(e.target.value) || 0)}
                                            onFocus={e => e.target.select()}
                                        />
                                    </td>
                                    <td className="p-2 text-center">
                                        <button onClick={() => removeItem(item.product.id)} className="text-red-400 hover:text-red-600 p-1">
                                            <Trash2 size={14}/>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {transferItems.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-gray-400">
                                        <div className="flex flex-col items-center gap-2">
                                            <Truck size={24} className="opacity-20"/>
                                            <p>Select items from source inventory.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer Action */}
                <div className="p-4 border-t bg-gray-50">
                    <div className="flex justify-between items-center mb-4 text-sm">
                        <span className="text-gray-500">Total Items: <strong>{transferItems.length}</strong></span>
                        <span className="text-gray-500">Total Value: <strong>{totalTransferValue.toFixed(2)}</strong></span>
                    </div>
                    <button 
                        onClick={handleExecuteTransfer}
                        disabled={isSubmitting || transferItems.length === 0}
                        className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-md flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {/* Fix: RefreshCw is now imported */}
                        {isSubmitting ? <RefreshCw className="animate-spin"/> : <CheckCircle size={20}/>}
                        {isSubmitting ? "Processing..." : "Confirm Transfer & Generate Manifest"}
                    </button>
                </div>
            </div>
        </div>
        ) : (
            <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col p-6 overflow-hidden">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <History className="text-indigo-600"/> Transfer History
                    </h2>
                    {history.length > 0 && (
                        <button 
                            onClick={generateFullHistoryPDF}
                            className="flex items-center gap-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 px-4 py-2 rounded-lg font-bold transition-colors shadow-sm text-sm"
                        >
                            <FileText size={18}/> Export Full History (PDF)
                        </button>
                    )}
                </div>
                
                <div className="flex-1 overflow-y-auto">
                    {history.length === 0 ? (
                        <div className="p-12 text-center text-gray-400 bg-gray-50 rounded-xl">
                            <Truck size={48} className="mx-auto opacity-20 mb-4"/>
                            <p className="text-lg">No transfer history found.</p>
                            <button onClick={() => setViewMode('NEW')} className="mt-4 text-indigo-600 font-bold hover:underline">Start a transfer</button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {history.map(record => (
                                <div key={record.id} className="border border-gray-200 rounded-xl p-5 hover:border-indigo-300 transition-colors shadow-sm bg-gray-50/50">
                                    <div className="flex justify-between items-start mb-4 pb-4 border-b border-gray-100">
                                        <div>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="font-black text-gray-800 text-lg">TRF-{record.batchId}</h3>
                                                <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded font-bold">{new Date(record.date).toLocaleDateString()}</span>
                                                {record.status === 'VOIDED' ? (
                                                    <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded font-black tracking-widest uppercase">VOIDED</span>
                                                ) : record.status === 'COMPLETED' ? (
                                                    <span className="bg-teal-100 text-teal-800 text-xs px-2 py-0.5 rounded font-black tracking-widest uppercase flex items-center gap-1">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
                                                        COMPLETED
                                                    </span>
                                                ) : (
                                                    <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded font-black tracking-widest uppercase flex items-center gap-1">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                                        ACTIVE
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-gray-500 text-sm mt-1">To: <strong className="text-gray-700">{record.destination}</strong></p>
                                        </div>
                                        <div className="text-right">
                                            <div className={`text-gray-900 font-black text-lg ${record.status === 'VOIDED' ? 'line-through opacity-50' : ''}`}>{record.totalValue.toFixed(2)}</div>
                                            <div className="text-gray-500 text-xs">{record.items.length} unique items ({record.totalQty} total units)</div>
                                            <div className="flex gap-2 justify-end mt-2 flex-wrap">
                                                {(!record.status || record.status === 'ACTIVE') && (
                                                    <button 
                                                        onClick={() => handleCompleteTransfer(record)}
                                                        disabled={isSubmitting}
                                                        className="flex items-center gap-1.5 text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 px-3 py-1.5 rounded-lg shadow-sm font-bold transition-all disabled:opacity-50"
                                                    >
                                                        <CheckCircle size={14}/> Complete Delivery
                                                    </button>
                                                )}
                                                {user?.role === 'ADMIN' && record.status !== 'VOIDED' && (
                                                    <button 
                                                        onClick={() => handleVoidTransfer(record)}
                                                        disabled={isSubmitting}
                                                        className="flex items-center gap-1.5 text-xs bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 hover:text-red-800 px-3 py-1.5 rounded-lg shadow-sm font-bold transition-all disabled:opacity-50"
                                                    >
                                                        <Ban size={14}/> Void
                                                    </button>
                                                )}
                                                <button 
                                                    onClick={() => downloadJSON(record.batchId, record, record.items, true)}
                                                    className="flex items-center gap-1.5 text-xs bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 px-3 py-1.5 rounded-lg shadow-sm font-bold transition-all"
                                                >
                                                    <Download size={14}/> JSON
                                                </button>
                                                <button 
                                                    onClick={() => generateManifestPDF(record.batchId, record, record.items, true)}
                                                    className="flex items-center gap-1.5 text-xs bg-white border border-gray-200 text-gray-700 hover:text-indigo-600 hover:border-indigo-200 px-3 py-1.5 rounded-lg shadow-sm font-bold transition-all"
                                                >
                                                    <Download size={14}/> Download PDF
                                                </button>
                                                <button 
                                                    onClick={() => generateManifestExcel(record.batchId, record, record.items, true)}
                                                    className="flex items-center gap-1.5 text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 px-3 py-1.5 rounded-lg shadow-sm font-bold transition-all"
                                                >
                                                    <FileSpreadsheet size={14}/> Excel
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                        <div>
                                            <div className="text-gray-400 font-bold uppercase mb-1">Driver / Vehicle</div>
                                            <div className="font-medium text-gray-700">{record.driver || 'N/A'} • {record.vehicleNo || 'N/A'}</div>
                                        </div>
                                        <div>
                                            <div className="text-gray-400 font-bold uppercase mb-1">Reason</div>
                                            <div className="font-medium text-gray-700">{record.reason || 'N/A'}</div>
                                        </div>
                                        <div>
                                            <div className="text-gray-400 font-bold uppercase mb-1">Operated By</div>
                                            <div className="font-medium text-gray-700">{record.userName || 'Unknown'}</div>
                                        </div>
                                        {record.status === 'VOIDED' && (
                                            <div>
                                                <div className="text-red-400 font-bold uppercase mb-1">Void Reason</div>
                                                <div className="font-medium text-red-700" title={record.voidReason}>{record.voidReason || 'N/A'}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        )}
    </div>
  );
}
