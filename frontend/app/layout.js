import './globals.css';

export const metadata = {
  title: 'ADAMAS — UNO No Mercy',
  description: 'ADAMAS game hub. Where the table is always set and the cards are merciless.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Chakra+Petch:wght@600;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
// EOF layout.js
