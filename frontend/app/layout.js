import './globals.css';

export const metadata = {
  title: 'ADAMAS — UNO No Mercy',
  description: 'ADAMAS game hub. Where the table is always set and the cards are merciless.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
// EOF layout.js
