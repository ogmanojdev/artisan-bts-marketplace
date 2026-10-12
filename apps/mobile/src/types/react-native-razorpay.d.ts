declare module "react-native-razorpay" {
  type CheckoutOptions = {
    key: string;
    order_id: string;
    amount: number;
    currency: string;
    name: string;
    description?: string;
    prefill?: { email?: string; contact?: string; name?: string };
    theme?: { color?: string };
  };
  const RazorpayCheckout: {
    open(options: CheckoutOptions): Promise<{ razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }>;
  };
  export default RazorpayCheckout;
}
