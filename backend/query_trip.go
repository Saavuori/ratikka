package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

func main() {
	query := `query {
		trip(id: "HSL:1009_20260615_Ma_2_1404") {
			gtfsId
			route {
				shortName
			}
			tripHeadsign
		}
	}`
	reqBody, _ := json.Marshal(map[string]string{"query": query})

	req, err := http.NewRequest("POST", "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1", bytes.NewBuffer(reqBody))
	if err != nil {
		panic(err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("digitransit-subscription-key", "631fd3dbd1b84f55904e1de6fcfebf1a")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Println(string(body))
}
