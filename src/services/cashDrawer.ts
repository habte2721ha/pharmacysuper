export const cashDrawerService = {
  port: null as any,
  isConnected: false,

  async connect() {
    if (!('serial' in navigator)) {
      alert("Web Serial API is not supported or is blocked by iframe permissions. Please open the app in a new tab using Chrome/Edge.");
      return false;
    }
    
    try {
      this.port = await (navigator as any).serial.requestPort();
      await this.port.open({ baudRate: 9600 });
      this.isConnected = true;
      alert("Serial hardware connected successfully.");
      return true;
    } catch (err: any) {
      console.error("Failed to connect to cash drawer", err);
      alert("Hardware connection failed: " + (err.message || "User aborted or permission denied"));
      this.isConnected = false;
      return false;
    }
  },

  async disconnect() {
    if (this.port) {
      await this.port.close();
      this.port = null;
      this.isConnected = false;
    }
  },

  async openDrawer() {
    if (!this.port) {
      alert("Hardware not connected. Please connect the serial port first.");
      return;
    }

    try {
      const writer = this.port.writable.getWriter();
      // Standard ESC/POS command to kick drawer: ESC p m t1 t2
      // 0x1B 0x70 0x00 0x19 0xFA
      const data = new Uint8Array([27, 112, 0, 25, 250]);
      await writer.write(data);
      writer.releaseLock();
      console.log("Cash drawer open command sent.");
      alert("Cash drawer kick signal sent!");
    } catch (err: any) {
      console.error("Failed to push open drawer command", err);
      alert("Failed to send drawer signal: " + (err.message || "Unknown error"));
    }
  },
  async testPrinter() {
    if (!this.port) {
      alert("Printer block not connected. Connect serial port first.");
      return;
    }

    try {
      const writer = this.port.writable.getWriter();
      
      const text = "\n------------------------\nPRINTER DIAGNOSTIC TEST\nSTATUS: ONLINE\n------------------------\n\n\n\n";
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      
      await writer.write(data);
      writer.releaseLock();
      console.log("Printer test command sent.");
      alert("Print payload sent to serial port!");
    } catch (err: any) {
      console.error("Failed to push printer test command", err);
      alert("Failed to send print payload: " + (err.message || "Unknown error"));
    }
  }
};
