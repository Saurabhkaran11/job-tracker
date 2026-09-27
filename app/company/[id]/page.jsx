'use client'

import { CompanyPage } from '../../../src/App'

// The company id comes from the folder name, so it arrives through Next's useParams
// inside CompanyPage rather than being threaded down here.
export default function Page() {
  return <CompanyPage />
}
